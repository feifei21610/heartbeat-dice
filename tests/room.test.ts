import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from '../packages/server/src/rooms/GameRoom.js';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  const server = new Server({ transport: new WebSocketTransport({}), greet: false });
  server.define('heartbeat_dice', GameRoom).filterBy(['roomCode']);
  colyseus = await boot(server, 0);
});

afterAll(async () => {
  await colyseus.shutdown();
});

afterEach(async () => {
  await colyseus.cleanup();
});

/** 建房 + 两人连入，返回 [room, host, guest] */
async function seatTwo(options: Record<string, unknown> = {}) {
  const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', {
    targetRounds: 3,
    spiceLevel: 'flirty',
    ...options,
  });
  const host = await colyseus.connectTo(room, { nickname: 'tangni' });
  const guest = await colyseus.connectTo(room, { nickname: 'harriet' });
  return { room, host, guest };
}

/**
 * 推进一步并等到服务端状态真的变了。
 * ★ 限流是 8 次/秒，所以驱动节奏必须比真人还慢，否则合法动作会被限流拒掉
 *   （测试曾因此偶发失败，不是产品 bug）。
 */
async function step(room: GameRoom, send: () => void) {
  const before = JSON.stringify(snapshotKey(room));
  send();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (JSON.stringify(snapshotKey(room)) !== before) return;
  }
  throw new Error('state did not advance');
}

function snapshotKey(room: GameRoom) {
  const g = (room as any).game;
  return [
    room.state.roomPhase,
    g?.round,
    g?.roundPhase,
    g?.players.map((p: any) => p.hasRolled),
    g?.history.length,
  ];
}

/** 双方都掷，直到本轮判出结果（跳过平局重掷） */
async function rollUntilDecided(room: GameRoom, host: any, guest: any) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const game = (room as any).game;
    if (game.roundPhase === 'truth') return game;

    if (game.roundPhase === 'tie') {
      await step(room, () => host.send('action', { type: 'ResetTie' }));
    } else {
      const idx = game.players.findIndex((p: any) => !p.hasRolled);
      await step(room, () => (idx === 0 ? host : guest).send('action', { type: 'Roll' }));
    }
  }
  throw new Error('round never decided');
}

describe('room config', () => {
  it('clamps targetRounds coming from the client', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', { targetRounds: 999 });
    expect(room.state.targetRounds).toBe(20);
  });

  it('falls back to a safe spice level on garbage input', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', { spiceLevel: 'wat' });
    expect(room.state.spiceLevel).toBe('flirty');
  });

  it('uses a 4-digit room code when provided', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', { roomCode: '8341' });
    expect(room.roomId).toBe('8341');
  });

  it('ignores a malformed room code', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', { roomCode: 'abc' });
    expect(room.roomId).not.toBe('abc');
  });
});

describe('seating', () => {
  it('assigns sequential seats and makes the first joiner host', async () => {
    const { room, host } = await seatTwo();
    expect(room.state.players.length).toBe(2);
    expect(room.state.players.map((p) => p.playerIndex)).toEqual([0, 1]);
    expect(room.state.hostSessionId).toBe(host.sessionId);
  });

  it('sanitizes an empty nickname', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', {});
    await colyseus.connectTo(room, { nickname: '   ' });
    expect(room.state.players[0].nickname).toBe('神秘人');
  });

  it('truncates an overlong nickname', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', {});
    await colyseus.connectTo(room, { nickname: 'x'.repeat(50) });
    expect(room.state.players[0].nickname.length).toBe(12);
  });

  it('sends fullStateSync on join', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', { targetRounds: 5 });
    const client = await colyseus.connectTo(room, { nickname: 'tangni' });
    const payload = await client.waitForMessage('fullStateSync');
    expect(payload).toMatchObject({
      roomPhase: 'lobby',
      isHost: true,
      myPlayerIndex: 0,
      targetRounds: 5,
    });
  });
});

describe('host-only permissions', () => {
  it('rejects startGame from the guest', async () => {
    const { room, guest } = await seatTwo();
    guest.send('startGame');
    const err = await guest.waitForMessage('error');
    expect(err.message).toContain('房主');
    expect(room.state.roomPhase).toBe('lobby');
  });

  it('rejects updateConfig from the guest', async () => {
    const { room, guest } = await seatTwo();
    guest.send('updateConfig', { targetRounds: 20 });
    await guest.waitForMessage('error');
    expect(room.state.targetRounds).toBe(3);
  });

  it('lets the host change config in the lobby', async () => {
    const { room, host } = await seatTwo();
    host.send('updateConfig', { targetRounds: 9, spiceLevel: 'heart' });
    await room.waitForNextMessage();
    expect(room.state.targetRounds).toBe(9);
    expect(room.state.spiceLevel).toBe('heart');
  });

  it('refuses to start with only one player', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', {});
    const host = await colyseus.connectTo(room, { nickname: 'tangni' });
    host.send('startGame');
    const err = await host.waitForMessage('error');
    expect(err.message).toContain('等对方');
  });
});

describe('gameplay authority', () => {
  it('starts the game and broadcasts a snapshot', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    const payload = await guest.waitForMessage('gameStarted');
    expect(room.state.roomPhase).toBe('playing');
    expect(payload.snapshot.round).toBe(1);
    expect(payload.snapshot.players.map((p: any) => p.nickname)).toEqual(['tangni', 'harriet']);
  });

  it('rejects actions before the game starts', async () => {
    const { host } = await seatTwo();
    host.send('action', { type: 'Roll' });
    const err = await host.waitForMessage('error');
    expect(err.message).toContain('还不能操作');
  });

  it('rejects an unknown action type', async () => {
    const { room, host } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    host.send('action', { type: 'Explode' });
    const err = await host.waitForMessage('error');
    expect(err.message).toContain('不认识');
  });

  it('ignores a client-supplied playerIndex and uses the session seat', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');

    // guest 谎报自己是 0 号位
    guest.send('action', { type: 'Roll', playerIndex: 0 });
    await guest.waitForMessage('actionApplied');

    const game = (room as any).game;
    expect(game.players[1].hasRolled).toBe(true);
    expect(game.players[0].hasRolled).toBe(false);
  });

  it('rejects rolling twice in the same round', async () => {
    const { room, host } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    host.send('action', { type: 'Roll' });
    await room.waitForNextMessage();
    host.send('action', { type: 'Roll' });
    const err = await host.waitForMessage('error');
    expect(err.message).toContain('不能这么做');
  });

  it('only the loser may finish the truth', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    const game = await rollUntilDecided(room, host, guest);

    const winnerClient = game.loserIndex === 0 ? guest : host;
    winnerClient.send('action', { type: 'TruthDone' });
    const err = await winnerClient.waitForMessage('error');
    expect(err.message).toContain('不能这么做');
  });

  it('mirrors engine scores into the schema', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    const game = await rollUntilDecided(room, host, guest);
    const winner = game.loserIndex === 0 ? 1 : 0;
    expect(room.state.players[winner].score).toBe(1);
  });

  it('reaches gameOver after the configured rounds', async () => {
    const { room, host, guest } = await seatTwo({ targetRounds: 3 });
    host.send('startGame');
    await host.waitForMessage('gameStarted');

    for (let r = 0; r < 3; r++) {
      const game = await rollUntilDecided(room, host, guest);
      const loserClient = game.loserIndex === 0 ? host : guest;
      await step(room, () => loserClient.send('action', { type: 'TruthDone' }));
    }

    expect(room.state.roomPhase).toBe('gameOver');
    expect((room as any).game.history).toHaveLength(3);
  });

  it('rate limits an action flood', async () => {
    const { room, host } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');

    // 洪水里前几条会因为「已经掷过」被判非法，限流错误夹在后面，
    // 所以要收集全部 error 再断言，不能只等第一条。
    const errors: string[] = [];
    host.onMessage('error', (m: any) => errors.push(m.message));
    for (let i = 0; i < 20; i++) host.send('action', { type: 'Roll' });

    for (let i = 0; i < 40 && !errors.some((m) => m.includes('慢一点')); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(errors.some((m) => m.includes('慢一点'))).toBe(true);
  });
});

describe('play again', () => {
  it('rejects playAgain mid-game', async () => {
    const { room, host } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    host.send('playAgain');
    const err = await host.waitForMessage('error');
    expect(err.message).toContain('还没结束');
  });
});

describe('disconnect handling', () => {
  it('removes the seat when leaving from the lobby', async () => {
    const { room, guest } = await seatTwo();
    await guest.leave(true);
    await room.waitForNextPatch();
    expect(room.state.players.length).toBe(1);
  });

  it('compacts seat indices after a lobby departure', async () => {
    const room = await colyseus.createRoom<GameRoom>('heartbeat_dice', {});
    const a = await colyseus.connectTo(room, { nickname: 'a' });
    await colyseus.connectTo(room, { nickname: 'b' });
    await a.leave(true);
    await room.waitForNextPatch();
    expect(room.state.players.map((p) => p.playerIndex)).toEqual([0]);
    expect(room.state.players[0].nickname).toBe('b');
  });

  it('transfers host when the host leaves the lobby', async () => {
    const { room, host, guest } = await seatTwo();
    await host.leave(true);
    await room.waitForNextPatch();
    expect(room.state.hostSessionId).toBe(guest.sessionId);
  });

  it('marks a player disconnected instead of removing them mid-game', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');

    // consented=false → 异常断线路径
    await guest.leave(false);
    await room.waitForNextPatch();

    expect(room.state.players.length).toBe(2);
    expect(room.state.players[1].connected).toBe(false);
  });

  it('reclaims a disconnected seat by nickname', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    await guest.leave(false);
    await room.waitForNextPatch();

    // 换设备/清缓存后靠昵称回来
    const back = await colyseus.connectTo(room, { nickname: 'harriet' });
    const payload = await back.waitForMessage('fullStateSync');

    expect(room.state.players.length).toBe(2);
    expect(room.state.players[1].connected).toBe(true);
    expect(payload.myPlayerIndex).toBe(1);
    expect(payload.roomPhase).toBe('playing');
    expect(payload.snapshot).not.toBeNull();
  });

  it('a reclaimed player can act again', async () => {
    const { room, host, guest } = await seatTwo();
    host.send('startGame');
    await host.waitForMessage('gameStarted');
    await guest.leave(false);
    await room.waitForNextPatch();

    const back = await colyseus.connectTo(room, { nickname: 'harriet' });
    await back.waitForMessage('fullStateSync');

    await step(room, () => back.send('action', { type: 'Roll' }));
    expect((room as any).game.players[1].hasRolled).toBe(true);
  });
});
