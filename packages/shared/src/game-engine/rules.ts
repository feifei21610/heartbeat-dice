import type { GameState, Player, TruthCard } from '../types/game.js';
import { DICE_FACES, DICE_PER_ROLL } from '../constants/game.js';
import { getTruthDeck } from '../data/truths.js';
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

/** 只有本轮输家能操作真心话（答完 / 换题） */
export function canActOnTruth(state: GameState, playerIndex: number): boolean {
  if (state.phase !== 'playing') return false;
  if (state.roundPhase !== 'truth') return false;
  return state.loserIndex === playerIndex;
}

export function canRerollTruth(state: GameState, playerIndex: number): boolean {
  return canActOnTruth(state, playerIndex) && state.truthRerollsLeft > 0;
}

/** 平局后任一方都可以点重掷 */
export function canResetTie(state: GameState, playerIndex: number): boolean {
  if (state.phase !== 'playing') return false;
  if (state.roundPhase !== 'tie') return false;
  return playerIndex >= 0 && playerIndex < state.players.length;
}

/**
 * 抽一道没用过的题。牌库抽干时清空 usedTruthIds 重新洗。
 * 返回 [题目, 新的 rngCursor, 新的 usedTruthIds]。
 */
export function drawTruth(state: GameState): [TruthCard, number, string[]] {
  const deck = getTruthDeck(state.spiceLevel);
  let used = state.usedTruthIds;
  let pool = deck.filter((c) => !used.includes(c.id));
  if (pool.length === 0) {
    used = [];
    pool = deck;
  }
  const rng = createRng(state.seed, state.rngCursor);
  const card = pool[rng.nextInt(pool.length)];
  return [card, rng.cursor(), [...used, card.id]];
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
