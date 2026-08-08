import { ColyseusSDK, type Room } from '@colyseus/sdk';
import type { GameState, SpiceLevel } from '@game/shared/types';

/**
 * 网络层：把 Colyseus 封装成事件发射器，store 只订阅事件。
 *
 * ★ 这一层不做任何游戏判断，也不设置 UI phase。
 *   phase 切换必须由服务端下发的数据驱动（playbook §5.4）。
 */

const ROOM_NAME = 'heartbeat_dice';

/** ★ 必须用 localStorage，不能用 sessionStorage（playbook §5.2 第 1 点）。
 *  sessionStorage 在关标签页 / 新标签页开分享链接 / 手机切后台被回收时全部丢失。 */
const TOKEN_KEY = 'hd.reconnectToken.v1';
const ROOM_KEY = 'hd.roomId.v1';
const NICK_KEY = 'hd.nickname.v1';

export interface PlayerBrief {
  nickname: string;
  playerIndex: number;
  connected: boolean;
  score: number;
}

/**
 * 服务端 fullStateSync 的报文形状。
 * ★ 加字段时这里必须同步改，否则 TS 不会报错但线上读到 undefined（playbook §11）。
 */
export interface FullStateSync {
  roomId: string;
  roomPhase: 'lobby' | 'playing' | 'gameOver';
  hostSessionId: string;
  isHost: boolean;
  myPlayerIndex: number;
  targetRounds: number;
  spiceLevel: SpiceLevel;
  players: PlayerBrief[];
  snapshot: GameState | null;
}

export interface ActionApplied {
  action: { type: string; playerIndex: number };
  byNickname: string;
  snapshot: GameState;
}

type Events = {
  fullStateSync: FullStateSync;
  actionApplied: ActionApplied;
  gameStarted: { snapshot: GameState };
  gameOver: { snapshot: GameState };
  error: { message: string };
  playerJoined: { nickname: string; playerIndex: number };
  playerLeft: { nickname: string };
  playerDisconnected: { nickname: string; playerIndex: number };
  playerReconnected: { nickname: string; playerIndex: number };
  playerReclaimed: { nickname: string; playerIndex: number };
  reconnectFailed: { nickname: string; playerIndex: number };
  /** 客户端自己判定的断线（WS 异常关闭 或 browser offline） */
  connectionLost: { reason: 'socket' | 'offline' };
  /** 重连尝试进度 */
  reconnecting: { attempt: number };
  schemaChanged: { targetRounds: number; spiceLevel: SpiceLevel; roomPhase: string };
};

type Handler<K extends keyof Events> = (payload: Events[K]) => void;

const SERVER_URL =
  (import.meta as any).env?.VITE_SERVER_URL ?? 'ws://localhost:2567';

/** 冷启动首连要给足时间（playbook §8 坑 2：scale-to-zero 唤醒 2–5s） */
const CONNECT_TIMEOUT_MS = 9000;

class NetworkClient {
  private sdk = new ColyseusSDK(SERVER_URL);
  private room: Room | null = null;
  private handlers = new Map<string, Set<Function>>();
  /** 区分主动退出与异常断线，避免 leave() 触发重连循环 */
  private intentionalLeave = false;
  private offlineBound = false;

  on<K extends keyof Events>(type: K, fn: Handler<K>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn);
    this.handlers.set(type, set);
    return () => set.delete(fn);
  }

  private emit<K extends keyof Events>(type: K, payload: Events[K]) {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<K>)(payload));
  }

  get sessionId() {
    return this.room?.sessionId ?? '';
  }

  get roomId() {
    return this.room?.roomId ?? '';
  }

  get isConnected() {
    return this.room !== null;
  }

  hasStoredSession(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  storedNickname(): string {
    return localStorage.getItem(NICK_KEY) ?? '';
  }

  storedRoomId(): string {
    return localStorage.getItem(ROOM_KEY) ?? '';
  }

  // ------------------------------------------------------------- connect

  async createRoom(opts: {
    nickname: string;
    roomCode: string;
    targetRounds: number;
    spiceLevel: SpiceLevel;
  }) {
    const room = await this.withTimeout(
      this.sdk.joinOrCreate(ROOM_NAME, {
        nickname: opts.nickname,
        roomCode: opts.roomCode,
        targetRounds: opts.targetRounds,
        spiceLevel: opts.spiceLevel,
      }),
    );
    this.adopt(room, opts.nickname);
    return room;
  }

  async joinRoom(opts: { nickname: string; roomId: string }) {
    const room = await this.withTimeout(
      this.sdk.joinById(opts.roomId, { nickname: opts.nickname }),
    );
    this.adopt(room, opts.nickname);
    return room;
  }

  /**
   * 用 localStorage 里的 token 重连。
   * ★ 只负责恢复连接，不设置任何 UI phase —— 那是 fullStateSync 的事。
   */
  async reconnect() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error('no reconnect token');
    const room = await this.withTimeout(this.sdk.reconnect(token));
    this.adopt(room, this.storedNickname());
    return room;
  }

  /** 昵称重认领：token 废掉时（换设备 / 清缓存）的备用路径 */
  async reclaimByNickname() {
    const roomId = this.storedRoomId();
    const nickname = this.storedNickname();
    if (!roomId || !nickname) throw new Error('no stored room');
    return this.joinRoom({ nickname, roomId });
  }

  /** 冷启动第一次请求负责唤醒机器，超时后自动重试一次（playbook §8 坑 2） */
  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('连接超时，服务器可能在唤醒中')), CONNECT_TIMEOUT_MS),
    );
    return Promise.race([p, timeout]);
  }

  private adopt(room: Room, nickname: string) {
    this.room = room;
    this.intentionalLeave = false;

    localStorage.setItem(TOKEN_KEY, room.reconnectionToken);
    localStorage.setItem(ROOM_KEY, room.roomId);
    localStorage.setItem(NICK_KEY, nickname);

    room.onMessage('fullStateSync', (m: FullStateSync) => this.emit('fullStateSync', m));
    room.onMessage('actionApplied', (m: ActionApplied) => this.emit('actionApplied', m));
    room.onMessage('gameStarted', (m: any) => this.emit('gameStarted', m));
    room.onMessage('gameOver', (m: any) => this.emit('gameOver', m));
    room.onMessage('error', (m: any) => this.emit('error', m));
    room.onMessage('playerJoined', (m: any) => this.emit('playerJoined', m));
    room.onMessage('playerLeft', (m: any) => this.emit('playerLeft', m));
    room.onMessage('playerDisconnected', (m: any) => this.emit('playerDisconnected', m));
    room.onMessage('playerReconnected', (m: any) => this.emit('playerReconnected', m));
    room.onMessage('playerReclaimed', (m: any) => this.emit('playerReclaimed', m));
    room.onMessage('reconnectFailed', (m: any) => this.emit('reconnectFailed', m));

    // Schema 同步：大厅配置靠这个即时更新
    room.onStateChange((state: any) => {
      this.emit('schemaChanged', {
        targetRounds: state.targetRounds,
        spiceLevel: state.spiceLevel,
        roomPhase: state.roomPhase,
      });
    });

    // ★ 实时断线检测（playbook §5.2 第 2 点）：
    //   code !== NORMAL_CLOSURE 视为异常断线。
    room.onLeave((code: number) => {
      this.room = null;
      if (this.intentionalLeave) return;
      if (code === 1000 || code === 4000) return;
      this.emit('connectionLost', { reason: 'socket' });
    });

    this.bindOfflineDetection();
  }

  /**
   * ★ 同时监听 browser offline（playbook §5.2 第 2 点）：
   *   拔网线 / setOffline 不会立刻关闭 WebSocket（要等 TCP 超时几十秒），
   *   只靠 WS 回调会有几十秒的假死窗口。
   */
  private bindOfflineDetection() {
    if (this.offlineBound) return;
    this.offlineBound = true;
    window.addEventListener('offline', () => {
      if (this.intentionalLeave) return;
      this.emit('connectionLost', { reason: 'offline' });
    });
  }

  // ------------------------------------------------------------- send

  sendAction(type: 'Roll' | 'TruthDone' | 'RerollTruth' | 'ResetTie') {
    this.room?.send('action', { type });
  }

  startGame() {
    this.room?.send('startGame');
  }

  playAgain() {
    this.room?.send('playAgain');
  }

  updateConfig(cfg: { targetRounds?: number; spiceLevel?: SpiceLevel }) {
    this.room?.send('updateConfig', cfg);
  }

  requestSync() {
    this.room?.send('requestSync');
  }

  // ------------------------------------------------------------- teardown

  /** 主动退出：必须清 localStorage，否则下次启动拿着过期 token 撞墙 */
  async leave() {
    this.intentionalLeave = true;
    this.clearSession();
    try {
      await this.room?.leave(true);
    } catch {
      // 已经断了就算了
    }
    this.room = null;
  }

  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROOM_KEY);
    localStorage.removeItem(NICK_KEY);
  }

  notifyReconnecting(attempt: number) {
    this.emit('reconnecting', { attempt });
  }
}

export const networkClient = new NetworkClient();
