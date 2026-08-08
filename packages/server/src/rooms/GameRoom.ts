import { Client, Room } from 'colyseus';
import { CloseCode } from '@colyseus/shared-types';
import {
  applyAction,
  clampRounds,
  randomSeed,
  startNewGame,
} from '@game/shared/game-engine';
import type { Action, GameState, SpiceLevel } from '@game/shared/types';
import { RECONNECT_WINDOW_SECONDS } from '@game/shared/constants';
import { GameRoomState, PlayerSchema } from '../schema/GameRoomState.js';

const PLAYER_COUNT = 2;
const VALID_SPICE: SpiceLevel[] = ['sweet', 'flirty', 'heart'];

/** 每 session 的限流窗口 */
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 8;

interface SessionInfo {
  playerIndex: number;
  nickname: string;
}

/**
 * 权威房间。服务端持有唯一的 GameState，客户端只消费快照。
 * 不做乐观更新（playbook §3.1）。
 */
export class GameRoom extends Room<{ state: GameRoomState }> {
  /** ★ 唯一真相：服务端的完整游戏状态 */
  private game: GameState | null = null;

  private sessions = new Map<string, SessionInfo>();
  private rateBuckets = new Map<string, number[]>();
  /** 正在等待重连的座位 → 用于取消挂起的 allowReconnection */
  private pendingReconnects = new Map<number, () => void>();

  onCreate(options: any) {
    this.autoDispose = true;
    this.maxClients = PLAYER_COUNT;

    // 4 位数字房号，方便口头报给对方
    if (typeof options?.roomCode === 'string' && /^\d{4}$/.test(options.roomCode)) {
      this.roomId = options.roomCode;
    }

    this.state = new GameRoomState();
    // 房间配置一律钳制，不信客户端
    this.state.targetRounds = clampRounds(Number(options?.targetRounds));
    this.state.spiceLevel = this.sanitizeSpice(options?.spiceLevel);
    this.state.roomPhase = 'lobby';

    this.onMessage('action', (client, message) => this.handlePlayerAction(client, message));
    this.onMessage('startGame', (client) => this.handleStartGame(client));
    this.onMessage('playAgain', (client) => this.handlePlayAgain(client));
    this.onMessage('updateConfig', (client, message) => this.handleUpdateConfig(client, message));
    this.onMessage('requestSync', (client) => this.pushFullState(client));
  }

  // ---------------------------------------------------------------- join/leave

  onJoin(client: Client, options: any) {
    const nickname = this.sanitizeNickname(options?.nickname);

    // 昵称即身份的备用路径（playbook §5.2 第 4 点）：
    // 同房间内昵称匹配到一个 disconnected 座位 → 重认领。
    // token 绑浏览器，换设备/清缓存就废，这条是廉价兜底。
    const reclaimable = this.state.players.find(
      (p) => !p.connected && p.nickname === nickname,
    );
    if (reclaimable) {
      const idx = reclaimable.playerIndex;
      const staleSessionId = reclaimable.sessionId;

      // ★ 先撤掉这个座位挂起的 allowReconnection，否则旧的冻结连接
      //   一直占着 maxClients 名额，而且稍后会 resolve 出一个幽灵客户端。
      this.pendingReconnects.get(idx)?.();
      this.pendingReconnects.delete(idx);

      reclaimable.sessionId = client.sessionId;
      reclaimable.connected = true;
      this.sessions.delete(staleSessionId);
      this.sessions.set(client.sessionId, { playerIndex: idx, nickname });
      this.syncPlayerConnected(idx, true);
      this.refreshLock();
      this.broadcast('playerReclaimed', { nickname, playerIndex: idx });
      this.pushFullState(client);
      return;
    }

    if (this.state.players.length >= PLAYER_COUNT) {
      throw new Error('房间满了');
    }

    const playerIndex = this.state.players.length;
    const p = new PlayerSchema();
    p.sessionId = client.sessionId;
    p.nickname = nickname;
    p.playerIndex = playerIndex;
    this.state.players.push(p);
    this.sessions.set(client.sessionId, { playerIndex, nickname });

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    this.pushFullState(client);
    this.broadcast('playerJoined', { nickname, playerIndex });
  }

  /**
   * ★ 0.17 的签名是 (client, code: number)，不是 consented: boolean。
   *   0.17 也确实提供 onReconnect 钩子（0.15 没有）——但重连成功后的
   *   补发逻辑写在这里的 await 之后更集中，所以不额外用 onReconnect。
   */
  async onLeave(client: Client, code?: number) {
    const consented = code === CloseCode.CONSENTED;
    const info = this.sessions.get(client.sessionId);
    if (!info) return;

    // 主动退出，或还在大厅 → 直接移除座位
    if (consented || this.state.roomPhase === 'lobby') {
      this.removePlayer(client.sessionId);
      return;
    }

    this.syncPlayerConnected(info.playerIndex, false);
    this.broadcast('playerDisconnected', {
      nickname: info.nickname,
      playerIndex: info.playerIndex,
    });

    // ★ 冻结的连接仍占着 maxClients 名额，房间会保持 locked/full，
    //   于是「换设备后靠昵称重认领」那条兜底路径根本进不来。
    //   断线期间临时放宽一个名额并解锁；认领或重连后由 refreshLock() 收回。
    this.maxClients = PLAYER_COUNT + 1;
    await this.unlock();

    const reconnection = this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
    this.pendingReconnects.set(info.playerIndex, () => reconnection.reject());

    try {
      const back = await reconnection;
      this.pendingReconnects.delete(info.playerIndex);
      // 座位可能已被本人换设备用昵称认领走了
      if (!this.ownsSeat(client.sessionId, info.playerIndex)) {
        back.leave();
        return;
      }
      // 重连成功：sessionId 不变，座位原地复活
      this.syncPlayerConnected(info.playerIndex, true);
      this.refreshLock();
      this.broadcast('playerReconnected', {
        nickname: info.nickname,
        playerIndex: info.playerIndex,
      });
      // ★ 必须补发全量状态，否则重连回来卡在旧画面
      this.pushFullState(back);
    } catch {
      this.pendingReconnects.delete(info.playerIndex);
      // 座位已被昵称重认领的话，这个 reject 是我们自己发的，不要播报
      if (!this.ownsSeat(client.sessionId, info.playerIndex)) return;
      // 超时：座位保留为 disconnected，让对方看到「等待重连」而不是凭空消失。
      // 两人游戏没有 Bot 接管的意义（对面是女朋友，不是 AI）。
      this.sessions.delete(client.sessionId);
      this.broadcast('reconnectFailed', {
        nickname: info.nickname,
        playerIndex: info.playerIndex,
      });
    }
  }

  /** 所有座位都在线时锁房并收回临时名额；否则保持可加入 */
  private refreshLock() {
    const allConnected =
      this.state.players.length >= PLAYER_COUNT &&
      this.state.players.every((p) => p.connected);
    if (allConnected) {
      this.maxClients = PLAYER_COUNT;
      void this.lock();
    }
  }

  /** 这个 session 是否仍然是该座位的当前主人 */
  private ownsSeat(sessionId: string, playerIndex: number): boolean {
    const p = this.state.players.find((x) => x.playerIndex === playerIndex);
    return !!p && p.sessionId === sessionId;
  }

  private removePlayer(sessionId: string) {
    const info = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    this.rateBuckets.delete(sessionId);
    if (!info) return;

    const idx = this.state.players.findIndex((p) => p.sessionId === sessionId);
    if (idx !== -1) this.state.players.splice(idx, 1);

    // 座位索引要重新压实，否则 playerIndex 与数组下标脱节
    this.state.players.forEach((p, i) => {
      p.playerIndex = i;
      const s = this.sessions.get(p.sessionId);
      if (s) s.playerIndex = i;
    });

    // 房主走了就把房主转给剩下的人
    if (this.state.hostSessionId === sessionId) {
      this.state.hostSessionId = this.state.players[0]?.sessionId ?? '';
    }

    this.broadcast('playerLeft', { nickname: info.nickname });
  }

  // ---------------------------------------------------------------- messages

  private handleUpdateConfig(client: Client, message: any) {
    if (!this.assertHost(client)) return;
    if (this.state.roomPhase !== 'lobby') {
      return client.send('error', { message: '游戏开始后不能改设置' });
    }
    if (message?.targetRounds !== undefined) {
      this.state.targetRounds = clampRounds(Number(message.targetRounds));
    }
    if (message?.spiceLevel !== undefined) {
      this.state.spiceLevel = this.sanitizeSpice(message.spiceLevel);
    }
  }

  private handleStartGame(client: Client) {
    if (!this.assertHost(client)) return;
    if (this.state.roomPhase !== 'lobby') {
      return client.send('error', { message: '游戏已经开始了' });
    }
    if (this.state.players.length < PLAYER_COUNT) {
      return client.send('error', { message: '等对方进来再开始' });
    }
    this.beginGame();
  }

  private handlePlayAgain(client: Client) {
    if (!this.assertHost(client)) return;
    if (this.state.roomPhase !== 'gameOver') {
      return client.send('error', { message: '这局还没结束' });
    }
    this.beginGame();
  }

  private beginGame() {
    const nicknames = this.state.players.map((p) => p.nickname) as [string, string];
    this.game = startNewGame({
      seed: randomSeed(),
      targetRounds: this.state.targetRounds,
      spiceLevel: this.state.spiceLevel as SpiceLevel,
      nicknames,
    });
    this.state.roomPhase = 'playing';
    this.state.round = this.game.round;
    this.syncScoreboard();
    this.broadcast('gameStarted', { snapshot: this.game });
  }

  private handlePlayerAction(client: Client, message: any) {
    // 闸 1：限流
    if (this.isRateLimited(client.sessionId)) {
      return client.send('error', { message: '慢一点，手别抖' });
    }

    const info = this.sessions.get(client.sessionId);
    if (!info) return;
    if (!this.game || this.state.roomPhase !== 'playing') {
      return client.send('error', { message: '现在还不能操作' });
    }

    const type = message?.type;
    if (type !== 'Roll' && type !== 'TruthDone' && type !== 'RerollTruth' && type !== 'ResetTie') {
      return client.send('error', { message: '不认识这个动作' });
    }

    // 闸 2：动作归属 —— playerIndex 一律由服务端按 session 填，忽略客户端传的
    const action = { type, playerIndex: info.playerIndex } as Action;

    // 闸 3：合法性 —— 重跑同一份引擎，靠恒等判断（见引擎注释）
    const next = applyAction(this.game, action);
    if (next === this.game) {
      return client.send('error', { message: '现在不能这么做' });
    }

    this.game = next;
    this.state.round = next.round;
    this.syncScoreboard();

    this.broadcast('actionApplied', {
      action,
      byNickname: info.nickname,
      snapshot: next,
    });

    if (next.phase === 'gameOver') {
      this.state.roomPhase = 'gameOver';
      this.broadcast('gameOver', { snapshot: next });
    }
  }

  // ---------------------------------------------------------------- helpers

  /** 全量状态：重连和新加入都靠这个。Schema 里的字段这里也要带上（playbook §3.2）。 */
  private pushFullState(client: Client) {
    const info = this.sessions.get(client.sessionId);
    client.send('fullStateSync', {
      roomId: this.roomId,
      roomPhase: this.state.roomPhase,
      hostSessionId: this.state.hostSessionId,
      isHost: this.state.hostSessionId === client.sessionId,
      myPlayerIndex: info?.playerIndex ?? -1,
      targetRounds: this.state.targetRounds,
      spiceLevel: this.state.spiceLevel,
      players: this.state.players.map((p) => ({
        nickname: p.nickname,
        playerIndex: p.playerIndex,
        connected: p.connected,
        score: p.score,
      })),
      snapshot: this.game,
    });
  }

  /** 把引擎里的分数/掷骰状态同步进 Schema，让大厅和重连能读到 */
  private syncScoreboard() {
    if (!this.game) return;
    for (const p of this.state.players) {
      const gp = this.game.players[p.playerIndex];
      if (!gp) continue;
      p.score = gp.score;
      p.hasRolled = gp.hasRolled;
    }
  }

  private syncPlayerConnected(playerIndex: number, connected: boolean) {
    const p = this.state.players.find((x) => x.playerIndex === playerIndex);
    if (p) p.connected = connected;
    if (this.game) {
      this.game = {
        ...this.game,
        players: this.game.players.map((gp, i) =>
          i === playerIndex ? { ...gp, connected } : gp,
        ),
      };
    }
  }

  private assertHost(client: Client): boolean {
    if (this.state.hostSessionId !== client.sessionId) {
      client.send('error', { message: '只有房主能做这个操作' });
      return false;
    }
    return true;
  }

  private isRateLimited(sessionId: string): boolean {
    const now = Date.now();
    const bucket = (this.rateBuckets.get(sessionId) ?? []).filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );
    bucket.push(now);
    this.rateBuckets.set(sessionId, bucket);
    return bucket.length > RATE_LIMIT_MAX;
  }

  private sanitizeNickname(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim().slice(0, 12) : '';
    return s.length > 0 ? s : '神秘人';
  }

  private sanitizeSpice(raw: unknown): SpiceLevel {
    return VALID_SPICE.includes(raw as SpiceLevel) ? (raw as SpiceLevel) : 'flirty';
  }
}
