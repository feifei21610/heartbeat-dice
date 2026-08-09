import type { Action, GameState, RoundRecord } from '../types/game.js';
import {
  allRolled,
  canFinishTruth,
  canPickTruth,
  canResetTie,
  canRoll,
  diceTotal,
  drawTruthChoices,
  findLoserIndex,
  rollDice,
} from './rules.js';
import { resetForNextRound } from './round.js';

/**
 * 引擎唯一入口。
 *
 * ★ 契约：动作非法时**返回传入的同一个对象**（`next === state` 恒等），
 *   而不是抛异常。服务端就靠这个恒等判断来拒绝非法动作（见 playbook §4）。
 *   任何新增的 action 分支都必须遵守这条，否则服务端校验会失效。
 *
 * 一轮的流程：
 *   rolling → （都掷完）→ picking（赢家从 4 道候选里挑一道）
 *                       → truth（输家回答）→ 下一轮 / gameOver
 *           → tie（点数相同）→ 重掷
 */
export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'Roll':
      return handleRoll(state, action.playerIndex);
    case 'PickTruth':
      return handlePickTruth(state, action.playerIndex, action.choiceIndex);
    case 'TruthDone':
      return handleTruthDone(state, action.playerIndex);
    case 'ResetTie':
      return handleResetTie(state, action.playerIndex);
    default:
      return state;
  }
}

function handleRoll(state: GameState, playerIndex: number): GameState {
  if (!canRoll(state, playerIndex)) return state;

  const [dice, cursor] = rollDice(state.seed, state.rngCursor);
  let next: GameState = {
    ...state,
    rngCursor: cursor,
    players: state.players.map((p, i) =>
      i === playerIndex ? { ...p, dice, hasRolled: true } : p,
    ),
  };

  if (!allRolled(next)) return next;

  // 双方都掷完了 → 判定胜负
  const loserIndex = findLoserIndex(next.players);
  if (loserIndex === -1) {
    return { ...next, roundPhase: 'tie', loserIndex: -1 };
  }

  // 赢家 +1 分，并拿到一组候选题去挑
  const [choices, choiceCursor, usedTruthIds] = drawTruthChoices(next);
  return {
    ...next,
    rngCursor: choiceCursor,
    usedTruthIds,
    truthChoices: choices,
    currentTruth: null,
    loserIndex,
    roundPhase: 'picking',
    players: next.players.map((p, i) =>
      i === loserIndex ? p : { ...p, score: p.score + 1 },
    ),
  };
}

/** 赢家挑定一道题 → 进入输家回答阶段 */
function handlePickTruth(
  state: GameState,
  playerIndex: number,
  choiceIndex: number,
): GameState {
  if (!canPickTruth(state, playerIndex, choiceIndex)) return state;
  return {
    ...state,
    currentTruth: state.truthChoices[choiceIndex],
    truthChoices: [],
    roundPhase: 'truth',
  };
}

function handleTruthDone(state: GameState, playerIndex: number): GameState {
  if (!canFinishTruth(state, playerIndex)) return state;
  const truth = state.currentTruth;
  if (!truth) return state;

  const record: RoundRecord = {
    round: state.round,
    totals: state.players.map((p) => diceTotal(p.dice)),
    loserIndex: state.loserIndex,
    truthId: truth.id,
    truthText: truth.text,
  };
  const withHistory: GameState = { ...state, history: [...state.history, record] };

  if (state.round >= state.targetRounds) {
    return { ...withHistory, phase: 'gameOver', roundPhase: 'reveal' };
  }
  return resetForNextRound(withHistory, state.round + 1);
}

/** 平局：不计分、不记历史，原轮次重掷。 */
function handleResetTie(state: GameState, playerIndex: number): GameState {
  if (!canResetTie(state, playerIndex)) return state;
  return resetForNextRound(state, state.round);
}
