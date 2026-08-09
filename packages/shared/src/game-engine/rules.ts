import type { GameState, Player, TruthCard } from '../types/game.js';
import { DICE_FACES, DICE_PER_ROLL, TRUTH_CHOICE_COUNT } from '../constants/game.js';
import { ALL_TRUTHS } from '../data/truths.js';
import { createRng } from './rng.js';

/**
 * 纯判定函数。这里不产生新状态，只回答「能不能」和「是什么」。
 */

export function diceTotal(dice: [number, number] | null): number {
  return dice ? dice[0] + dice[1] : 0;
}

/** 当前玩家能不能掷骰子 */
export function canRoll(state: GameState, playerIndex: number): boolean {
  if (state.phase !== 'playing') return false;
  if (state.roundPhase !== 'rolling') return false;
  const p = state.players[playerIndex];
  if (!p) return false;
  return !p.hasRolled;
}

/** 双方是否都掷完了 */
export function allRolled(state: GameState): boolean {
  return state.players.every((p) => p.hasRolled);
}

/**
 * 判定输家。点数小的输；相等返回 -1（平局）。
 * 两人局，直接比。
 */
export function findLoserIndex(players: Player[]): number {
  const totals = players.map((p) => diceTotal(p.dice));
  const min = Math.min(...totals);
  const losers = totals.reduce<number[]>((acc, t, i) => (t === min ? [...acc, i] : acc), []);
  return losers.length === 1 ? losers[0] : -1;
}

/** 本轮赢家索引；平局或未判定时为 -1 */
export function winnerIndex(state: GameState): number {
  if (state.loserIndex < 0) return -1;
  return state.loserIndex === 0 ? 1 : 0;
}

/** 只有赢家能挑题，且必须在 picking 阶段 */
export function canPickTruth(
  state: GameState,
  playerIndex: number,
  choiceIndex: number,
): boolean {
  if (state.phase !== 'playing') return false;
  if (state.roundPhase !== 'picking') return false;
  if (winnerIndex(state) !== playerIndex) return false;
  return choiceIndex >= 0 && choiceIndex < state.truthChoices.length;
}

/** 只有本轮输家能宣布答完 */
export function canFinishTruth(state: GameState, playerIndex: number): boolean {
  if (state.phase !== 'playing') return false;
  if (state.roundPhase !== 'truth') return false;
  return state.loserIndex === playerIndex;
}

/** 平局后任一方都可以点重掷 */
export function canResetTie(state: GameState, playerIndex: number): boolean {
  if (state.phase !== 'playing') return false;
  if (state.roundPhase !== 'tie') return false;
  return playerIndex >= 0 && playerIndex < state.players.length;
}

/**
 * 从全部题目里**纯随机**抽 N 道互不相同的候选，交给赢家挑。
 *
 * 池子抽干时清空 usedTruthIds 重新洗。
 * 返回 [候选题, 新的 rngCursor, 新的 usedTruthIds]。
 */
export function drawTruthChoices(state: GameState): [TruthCard[], number, string[]] {
  let used = state.usedTruthIds;
  let pool = ALL_TRUTHS.filter((c) => !used.includes(c.id));

  // 剩的不够凑一组候选了 → 重新洗一遍
  if (pool.length < TRUTH_CHOICE_COUNT) {
    used = [];
    pool = ALL_TRUTHS;
  }

  const rng = createRng(state.seed, state.rngCursor);
  const remaining = [...pool];
  const picked: TruthCard[] = [];
  const count = Math.min(TRUTH_CHOICE_COUNT, remaining.length);
  for (let i = 0; i < count; i++) {
    const idx = rng.nextInt(remaining.length);
    picked.push(remaining[idx]);
    remaining.splice(idx, 1); // 抽出不放回，保证候选之间不重复
  }

  return [picked, rng.cursor(), [...used, ...picked.map((c) => c.id)]];
}

/** 掷两颗骰子。返回 [骰子, 新的 rngCursor]。 */
export function rollDice(seed: number, cursor: number): [[number, number], number] {
  const rng = createRng(seed, cursor);
  const dice: number[] = [];
  for (let i = 0; i < DICE_PER_ROLL; i++) {
    dice.push(rng.nextInt(DICE_FACES) + 1);
  }
  return [[dice[0], dice[1]], rng.cursor()];
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'gameOver';
}

/** 领先者索引；平分返回 -1 */
export function leaderIndex(state: GameState): number {
  const scores = state.players.map((p) => p.score);
  const max = Math.max(...scores);
  const leaders = scores.reduce<number[]>((acc, s, i) => (s === max ? [...acc, i] : acc), []);
  return leaders.length === 1 ? leaders[0] : -1;
}
