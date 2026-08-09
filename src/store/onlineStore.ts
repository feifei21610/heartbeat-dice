import { create } from 'zustand';
import type { GameState, SpiceLevel } from '@game/shared/types';
import { DEFAULT_ROUNDS, DEFAULT_SPICE_LEVEL } from '@game/shared/constants';
import {
  networkClient,
  type ActionApplied,
  type FullStateSync,
  type PlayerBrief,
} from '../network/client';

/**
 * 联机 store：只消费服务端快照，不做乐观更新（playbook §3.1）。
 *
 * ★ phase 必须由服务端下发的数据驱动，不由「操作成功」驱动（playbook §5.4）。
 *   reconnect() 成功时快照可能还没到，此时切到 playing 会白屏。
 */

export type UiPhase =
  | 'home'
  | 'connecting'
  | 'lobby'
  | 'playing'
  | 'gameOver'
  | 'reconnecting';

interface RoomInfo {
  roomId: string;
  isHost: boolean;
  myPlayerIndex: number;
  targetRounds: number;
  spiceLevel: SpiceLevel;
  players: PlayerBrief[];
}

interface OnlineState {
  phase: UiPhase;
  room: RoomInfo | null;
  snapshot: GameState | null;
  /** 错误提示条的内容。★ 联机项目第一个 UI 组件就该是它（playbook §4） */
  errorMessage: string | null;
  /** 底部飘过的一次性播报 */
  toast: string | null;
  reconnectAttempt: number;
  /** 上一个动作是谁做的，用于动画 */
  lastActionBy: string | null;

  createRoom: (nickname: string, targetRounds: number, spiceLevel: SpiceLevel) => Promise<void>;
  joinRoom: (nickname: string, roomId: string) => Promise<void>;
  tryResumeSession: () => Promise<void>;
  startGame: () => void;
  playAgain: () => void;
  updateConfig: (cfg: { targetRounds?: number; spiceLevel?: SpiceLevel }) => void;
  roll: () => void;
  truthDone: () => void;
  rerollTruth: () => void;
  resetTie: () => void;
  leave: () => Promise<void>;
  dismissError: () => void;
  dismissToast: () => void;
}

/** 服务端 roomPhase → UI phase。唯一的映射入口。 */
function toUiPhase(roomPhase: FullStateSync['roomPhase']): UiPhase {
  if (roomPhase === 'playing') return 'playing';
  if (roomPhase === 'gameOver') return 'gameOver';
  return 'lobby';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ★ 模块级守卫：否则每次重连都叠一层 handler，一个动作被处理多次（playbook §5.5） */
let listenersAttached = false;

/** 有 token 就直接进重连态，避免挂载瞬间闪一下首页 */
const initialPhase: UiPhase = networkClient.hasStoredSession() ? 'reconnecting' : 'home';

export const useOnlineStore = create<OnlineState>((set, get) => {
  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    // ★ 唯一的权威数据入口：phase / room / snapshot 全部由它设置
    networkClient.on('fullStateSync', (m) => {
      set({
        phase: toUiPhase(m.roomPhase),
        room: {
          roomId: m.roomId,
          isHost: m.isHost,
          myPlayerIndex: m.myPlayerIndex,
          targetRounds: m.targetRounds,
          spiceLevel: m.spiceLevel,
          players: m.players,
        },
        snapshot: m.snapshot,
        reconnectAttempt: 0,
      });
    });

    networkClient.on('gameStarted', (m) => {
      set({ phase: 'playing', snapshot: m.snapshot, toast: '开始了，别手软' });
    });

    /**
     * ★ Schema 自动同步：房主在等待室改配置时，客人靠这个即时看到。
     *   fullStateSync 只在加入那一刻发一次，光靠它的话房主之后的改动
     *   客人永远看不到（playbook §11 清单里「store 的监听」这一步）。
     */
    networkClient.on('schemaChanged', (m) => {
      const room = get().room;
      if (!room) return;
      if (
        room.targetRounds === m.targetRounds &&
        room.spiceLevel === m.spiceLevel
      ) {
        return;
      }
      set({
        room: {
          ...room,
          targetRounds: m.targetRounds,
          spiceLevel: m.spiceLevel,
        },
      });
    });

    networkClient.on('actionApplied', (m: ActionApplied) => {
      set({ snapshot: m.snapshot, lastActionBy: m.byNickname });
    });

    networkClient.on('gameOver', (m) => {
      set({ phase: 'gameOver', snapshot: m.snapshot });
    });

    // ★ error 必须有 UI 出口，不能只 console（playbook §4）
    networkClient.on('error', (m) => set({ errorMessage: m.message }));

    networkClient.on('playerJoined', (m) => {
      set({ toast: `${m.nickname} 来了` });
      networkClient.requestSync();
    });
    networkClient.on('playerLeft', (m) => {
      set({ toast: `${m.nickname} 离开了` });
      networkClient.requestSync();
    });
    networkClient.on('playerDisconnected', (m) => {
      set({ toast: `${m.nickname} 断线了，等一下` });
      networkClient.requestSync();
    });
    networkClient.on('playerReconnected', (m) => {
      set({ toast: `${m.nickname} 回来了` });
      networkClient.requestSync();
    });
    networkClient.on('playerReclaimed', (m) => {
      set({ toast: `${m.nickname} 回来了` });
      networkClient.requestSync();
    });
    networkClient.on('reconnectFailed', (m) => {
      set({ toast: `${m.nickname} 没能回来` });
    });

    // 客户端自己判定的断线 → 进重连循环
    networkClient.on('connectionLost', () => {
      const phase = get().phase;
      if (phase === 'home' || phase === 'reconnecting') return;
      set({ phase: 'reconnecting', reconnectAttempt: 0 });
      void runReconnectLoop();
    });
  }

  /**
   * 自动重连：指数退避 + 网络状态感知（playbook §5.2 第 3 点）。
   * 重连期间保留牌桌画面 + 叠提示条，不跳走、不白屏。
   *
   * ★ 刷新页面时会有竞态：新页面可能比服务端处理完 WS 关闭更快，
   *   此时 allowReconnection 还没注册，reconnect 会拿到 4003/522。
   *   所以必须重试若干次，不能一次失败就放弃（否则刷新永远回不去）。
   */
  async function runReconnectLoop() {
    for (let attempt = 1; attempt <= 12; attempt++) {
      // 网络没恢复就不消耗次数
      if (!navigator.onLine) {
        await sleep(1000);
        attempt--;
        continue;
      }
      set({ reconnectAttempt: attempt });
      try {
        await networkClient.reconnect();
        // ★ 不在这里设 phase！等 fullStateSync 到了再切（playbook §5.4）
        return;
      } catch {
        // token 路线失败，试昵称重认领（换设备 / 清缓存的兜底）
        try {
          await networkClient.reclaimByNickname();
          return;
        } catch {
          await sleep(Math.min(400 * 2 ** attempt, 6000));
        }
      }
    }
    // 最终失败：清掉过期 token，否则下次启动拿着它撞墙
    networkClient.clearSession();
    set({
      phase: 'home',
      errorMessage: '重连失败了，重新进房间试试',
      room: null,
      snapshot: null,
    });
  }

  return {
    phase: initialPhase,
    room: null,
    snapshot: null,
    errorMessage: null,
    toast: null,
    reconnectAttempt: 0,
    lastActionBy: null,

    async createRoom(nickname, targetRounds, spiceLevel) {
      attachListeners();
      set({ phase: 'connecting', errorMessage: null });
      const roomCode = String(Math.floor(1000 + Math.random() * 9000));
      try {
        await networkClient.createRoom({ nickname, roomCode, targetRounds, spiceLevel });
        // phase 留给 fullStateSync 设置
      } catch (e: any) {
        set({ phase: 'home', errorMessage: e?.message ?? '建房失败' });
      }
    },

    async joinRoom(nickname, roomId) {
      attachListeners();
      set({ phase: 'connecting', errorMessage: null });
      try {
        await networkClient.joinRoom({ nickname, roomId: roomId.trim() });
      } catch (e: any) {
        const raw = String(e?.message ?? '');
        let msg = raw || '进房失败';
        if (raw.includes('not found')) msg = '没找到这个房间，检查一下房号';
        else if (raw.includes('full')) msg = '房间满了';
        else if (raw.includes('locked')) msg = '这局已经开始了';
        set({ phase: 'home', errorMessage: msg });
      }
    },

    /** 刷新页面后自动回到牌桌。★ 走同一套带退避的重连循环，一次失败不放弃 */
    async tryResumeSession() {
      if (!networkClient.hasStoredSession()) return;
      attachListeners();
      set({ phase: 'reconnecting', reconnectAttempt: 1 });
      await runReconnectLoop();
    },

    startGame: () => networkClient.startGame(),
    playAgain: () => networkClient.playAgain(),
    updateConfig: (cfg) => networkClient.updateConfig(cfg),
    roll: () => networkClient.sendAction('Roll'),
    truthDone: () => networkClient.sendAction('TruthDone'),
    rerollTruth: () => networkClient.sendAction('RerollTruth'),
    resetTie: () => networkClient.sendAction('ResetTie'),

    async leave() {
      await networkClient.leave();
      set({ phase: 'home', room: null, snapshot: null, errorMessage: null, toast: null });
    },

    dismissError: () => set({ errorMessage: null }),
    dismissToast: () => set({ toast: null }),
  };
});

export const DEFAULTS = { rounds: DEFAULT_ROUNDS, spice: DEFAULT_SPICE_LEVEL };
