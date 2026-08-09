import type { GameOptions, GameState, Player } from '../types/game.js';
import { DEFAULT_ROUNDS, MAX_ROUNDS, MIN_ROUNDS } from '../constants/game.js';
import { randomSeed } from './rng.js';

function makePlayer(id: string, nickname: string, type: Player['type']): Player {
  return {
    id,
    nickname,
    type,
    score: 0,
    dice: null,
    hasRolled: false,
    connected: true,
  };
}

export function clampRounds(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ROUNDS;
  return Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, Math.floor(n)));
}

/** 开新局。options 里的数值一律钳制，不信任调用方。 */
export function startNewGame(options: Partial<GameOptions> = {}): GameState {
  const [n1, n2] = options.nicknames ?? ['我', '你'];
  return {
    seed: options.seed ?? randomSeed(),
    rngCursor: 0,
    players: [makePlayer('p0', n1, 'human'), makePlayer('p1', n2, 'remote')],
    round: 1,
    targetRounds: clampRounds(options.targetRounds ?? DEFAULT_ROUNDS),
    phase: 'playing',
    roundPhase: 'rolling',
    loserIndex: -1,
    truthChoices: [],
    currentTruth: null,
    usedTruthIds: [],
    history: [],
  };
}

/** 清空本轮的骰子与题目，进入下一轮的 rolling。不判断是否该结束。 */
export function resetForNextRound(state: GameState, nextRound: number): GameState {
  return {
    ...state,
    round: nextRound,
    roundPhase: 'rolling',
    loserIndex: -1,
    truthChoices: [],
    currentTruth: null,
    players: state.players.map((p) => ({ ...p, dice: null, hasRolled: false })),
  };
}
