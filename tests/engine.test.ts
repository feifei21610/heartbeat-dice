import { describe, expect, it } from 'vitest';
import {
  applyAction,
  startNewGame,
  createRng,
  diceTotal,
  findLoserIndex,
  winnerIndex,
} from '@game/shared/game-engine';
import type { GameState } from '@game/shared/types';
import { TRUTH_CATEGORIES } from '@game/shared/types';
import { TRUTH_CHOICE_COUNT } from '@game/shared/constants';
import { ALL_TRUTHS, getTruthDeck } from '@game/shared/data';

/** 反复掷到双方都掷完，返回结果状态。 */
function rollBoth(s: GameState): GameState {
  let next = applyAction(s, { type: 'Roll', playerIndex: 0 });
  next = applyAction(next, { type: 'Roll', playerIndex: 1 });
  return next;
}

/** 找一个不平局的 seed，掷完停在 picking 阶段 */
function seedWithDecisiveRoll(): GameState {
  for (let seed = 1; seed < 500; seed++) {
    const s = rollBoth(startNewGame({ seed, targetRounds: 5 }));
    if (s.roundPhase === 'picking') return s;
  }
  throw new Error('no decisive seed found');
}

/** 掷完并让赢家挑第一道题 → 停在 truth 阶段 */
function seedAtTruth(): GameState {
  const s = seedWithDecisiveRoll();
  return applyAction(s, { type: 'PickTruth', playerIndex: winnerIndex(s), choiceIndex: 0 });
}

function seedWithTie(): GameState {
  for (let seed = 1; seed < 2000; seed++) {
    const s = rollBoth(startNewGame({ seed, targetRounds: 5 }));
    if (s.roundPhase === 'tie') return s;
  }
  throw new Error('no tie seed found');
}

describe('rng', () => {
  it('same seed produces same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('cursor lets us resume a sequence mid-stream (reconnect case)', () => {
    const fresh = createRng(7);
    fresh.next();
    fresh.next();
    const expected = [fresh.next(), fresh.next()];

    const resumed = createRng(7, 2);
    expect([resumed.next(), resumed.next()]).toEqual(expected);
  });

  it('cursor reports total consumed including the fast-forward', () => {
    const rng = createRng(1, 5);
    rng.next();
    rng.next();
    expect(rng.cursor()).toBe(7);
  });

  it('nextInt stays in range', () => {
    const rng = createRng(123);
    for (let i = 0; i < 500; i++) {
      const v = rng.nextInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});

describe('startNewGame', () => {
  it('clamps targetRounds into legal range', () => {
    expect(startNewGame({ targetRounds: 1 }).targetRounds).toBe(3);
    expect(startNewGame({ targetRounds: 999 }).targetRounds).toBe(20);
    expect(startNewGame({ targetRounds: 7 }).targetRounds).toBe(7);
  });

  it('starts at round 1, rolling phase, nobody rolled', () => {
    const s = startNewGame({ seed: 1 });
    expect(s.round).toBe(1);
    expect(s.roundPhase).toBe('rolling');
    expect(s.phase).toBe('playing');
    expect(s.players.every((p) => !p.hasRolled && p.dice === null)).toBe(true);
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  });

  it('uses provided nicknames', () => {
    const s = startNewGame({ nicknames: ['tangni', 'harriet'] });
    expect(s.players.map((p) => p.nickname)).toEqual(['tangni', 'harriet']);
  });
});

describe('illegal actions return the identical object', () => {
  it('rolling twice is rejected', () => {
    const s = startNewGame({ seed: 3 });
    const once = applyAction(s, { type: 'Roll', playerIndex: 0 });
    expect(once).not.toBe(s);
    const twice = applyAction(once, { type: 'Roll', playerIndex: 0 });
    expect(twice).toBe(once);
  });

  it('out-of-range playerIndex is rejected', () => {
    const s = startNewGame({ seed: 3 });
    expect(applyAction(s, { type: 'Roll', playerIndex: 5 })).toBe(s);
    expect(applyAction(s, { type: 'Roll', playerIndex: -1 })).toBe(s);
  });

  it('TruthDone before the truth phase is rejected', () => {
    const s = startNewGame({ seed: 3 });
    expect(applyAction(s, { type: 'TruthDone', playerIndex: 0 })).toBe(s);
  });

  it('the winner cannot answer the truth', () => {
    const s = seedAtTruth();
    const winner = winnerIndex(s);
    expect(applyAction(s, { type: 'TruthDone', playerIndex: winner })).toBe(s);
  });

  it('the loser cannot pick their own question', () => {
    const s = seedWithDecisiveRoll();
    expect(
      applyAction(s, { type: 'PickTruth', playerIndex: s.loserIndex, choiceIndex: 0 }),
    ).toBe(s);
  });

  it('PickTruth with an out-of-range index is rejected', () => {
    const s = seedWithDecisiveRoll();
    const w = winnerIndex(s);
    expect(applyAction(s, { type: 'PickTruth', playerIndex: w, choiceIndex: -1 })).toBe(s);
    expect(applyAction(s, { type: 'PickTruth', playerIndex: w, choiceIndex: 99 })).toBe(s);
  });

  it('PickTruth twice is rejected (already left picking)', () => {
    const s = seedWithDecisiveRoll();
    const w = winnerIndex(s);
    const once = applyAction(s, { type: 'PickTruth', playerIndex: w, choiceIndex: 0 });
    expect(once).not.toBe(s);
    expect(applyAction(once, { type: 'PickTruth', playerIndex: w, choiceIndex: 1 })).toBe(once);
  });

  it('ResetTie outside a tie is rejected', () => {
    const s = seedWithDecisiveRoll();
    expect(applyAction(s, { type: 'ResetTie', playerIndex: 0 })).toBe(s);
  });

  it('unknown action type is rejected', () => {
    const s = startNewGame({ seed: 3 });
    // @ts-expect-error deliberately invalid
    expect(applyAction(s, { type: 'Nope', playerIndex: 0 })).toBe(s);
  });
});

describe('rolling and scoring', () => {
  it('a single roll does not resolve the round', () => {
    const s = applyAction(startNewGame({ seed: 5 }), { type: 'Roll', playerIndex: 0 });
    expect(s.roundPhase).toBe('rolling');
    expect(s.players[0].hasRolled).toBe(true);
    expect(s.players[1].hasRolled).toBe(false);
  });

  it('dice are always two values in 1..6', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = rollBoth(startNewGame({ seed }));
      for (const p of s.players) {
        expect(p.dice).not.toBeNull();
        for (const d of p.dice!) {
          expect(d).toBeGreaterThanOrEqual(1);
          expect(d).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('the lower total loses and the winner gains one point', () => {
    const s = seedWithDecisiveRoll();
    const totals = s.players.map((p) => diceTotal(p.dice));
    const expectedLoser = totals[0] < totals[1] ? 0 : 1;
    expect(s.loserIndex).toBe(expectedLoser);
    expect(s.players[expectedLoser].score).toBe(0);
    expect(s.players[expectedLoser === 0 ? 1 : 0].score).toBe(1);
  });

  it('a decisive roll lands in picking with a set of choices', () => {
    const s = seedWithDecisiveRoll();
    expect(s.roundPhase).toBe('picking');
    expect(s.currentTruth).toBeNull();
    expect(s.truthChoices).toHaveLength(TRUTH_CHOICE_COUNT);
  });

  it('choices come from the full library and are all distinct', () => {
    const s = seedWithDecisiveRoll();
    const ids = s.truthChoices.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of s.truthChoices) {
      expect(ALL_TRUTHS.some((x) => x.id === c.id)).toBe(true);
      expect(s.usedTruthIds).toContain(c.id);
    }
  });

  it('equal totals produce a tie with no score change', () => {
    const s = seedWithTie();
    expect(s.roundPhase).toBe('tie');
    expect(s.loserIndex).toBe(-1);
    expect(s.currentTruth).toBeNull();
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('findLoserIndex returns -1 only on equal totals', () => {
    const mk = (a: [number, number], b: [number, number]) =>
      startNewGame({ seed: 1 }).players.map((p, i) => ({ ...p, dice: i === 0 ? a : b }));
    expect(findLoserIndex(mk([1, 1], [6, 6]))).toBe(0);
    expect(findLoserIndex(mk([6, 6], [1, 1]))).toBe(1);
    expect(findLoserIndex(mk([3, 4], [4, 3]))).toBe(-1);
  });
});

describe('tie handling', () => {
  it('resetting a tie keeps the same round and clears dice', () => {
    const tie = seedWithTie();
    const next = applyAction(tie, { type: 'ResetTie', playerIndex: 0 });
    expect(next.round).toBe(tie.round);
    expect(next.roundPhase).toBe('rolling');
    expect(next.players.every((p) => p.dice === null && !p.hasRolled)).toBe(true);
    expect(next.history).toEqual(tie.history);
  });

  it('either player may reset a tie', () => {
    const tie = seedWithTie();
    expect(applyAction(tie, { type: 'ResetTie', playerIndex: 1 })).not.toBe(tie);
  });

  it('a reset tie rerolls to different dice (rng advanced)', () => {
    const tie = seedWithTie();
    const reset = applyAction(tie, { type: 'ResetTie', playerIndex: 0 });
    expect(reset.rngCursor).toBe(tie.rngCursor);
    const again = rollBoth(reset);
    // cursor moved forward, so we are not replaying the same dice
    expect(again.rngCursor).toBeGreaterThan(tie.rngCursor);
  });
});

describe('winner picks the question', () => {
  it('picking moves to the truth phase with that exact question', () => {
    const s = seedWithDecisiveRoll();
    const w = winnerIndex(s);
    const chosen = s.truthChoices[2];
    const next = applyAction(s, { type: 'PickTruth', playerIndex: w, choiceIndex: 2 });
    expect(next.roundPhase).toBe('truth');
    expect(next.currentTruth).toEqual(chosen);
  });

  it('choices are cleared once picked, so nothing stale renders', () => {
    const s = seedAtTruth();
    expect(s.truthChoices).toEqual([]);
  });

  it('any of the choices can be picked', () => {
    const s = seedWithDecisiveRoll();
    const w = winnerIndex(s);
    for (let i = 0; i < s.truthChoices.length; i++) {
      const next = applyAction(s, { type: 'PickTruth', playerIndex: w, choiceIndex: i });
      expect(next.currentTruth!.id).toBe(s.truthChoices[i].id);
    }
  });

  it('winnerIndex is the other seat, and -1 before a decision', () => {
    const fresh = startNewGame({ seed: 3 });
    expect(winnerIndex(fresh)).toBe(-1);
    const s = seedWithDecisiveRoll();
    expect(winnerIndex(s)).toBe(s.loserIndex === 0 ? 1 : 0);
  });

  it('a tie offers no choices', () => {
    const tie = seedWithTie();
    expect(tie.truthChoices).toEqual([]);
    expect(tie.currentTruth).toBeNull();
  });

  it('every round offers a fresh set of choices', () => {
    let s = seedAtTruth();
    const firstIds = new Set(s.usedTruthIds);
    s = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
    expect(s.truthChoices).toEqual([]);

    // 下一轮摇出胜负后应该拿到全新的候选
    let guard = 0;
    while (s.roundPhase !== 'picking' && guard++ < 40) {
      if (s.roundPhase === 'tie') {
        s = applyAction(s, { type: 'ResetTie', playerIndex: 0 });
        continue;
      }
      const idx = s.players.findIndex((p) => !p.hasRolled);
      s = applyAction(s, { type: 'Roll', playerIndex: idx });
    }
    expect(s.truthChoices).toHaveLength(TRUTH_CHOICE_COUNT);
    for (const c of s.truthChoices) {
      expect(firstIds.has(c.id)).toBe(false);
    }
  });

  it('never repeats a question across a long game, and never stalls', () => {
    // 打满远超一组候选的轮数，确认抽题池会重洗而不是卡死
    let s = startNewGame({ seed: 2024, targetRounds: 20 });
    const seen: string[] = [];
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 800) {
      if (s.roundPhase === 'rolling') {
        const idx = s.players.findIndex((p) => !p.hasRolled);
        s = applyAction(s, { type: 'Roll', playerIndex: idx });
      } else if (s.roundPhase === 'tie') {
        s = applyAction(s, { type: 'ResetTie', playerIndex: 0 });
      } else if (s.roundPhase === 'picking') {
        expect(s.truthChoices).toHaveLength(TRUTH_CHOICE_COUNT);
        s = applyAction(s, {
          type: 'PickTruth',
          playerIndex: winnerIndex(s),
          choiceIndex: 0,
        });
      } else if (s.roundPhase === 'truth') {
        seen.push(s.currentTruth!.id);
        s = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
      } else {
        break;
      }
    }
    expect(s.phase).toBe('gameOver');
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('round advance and game over', () => {
  it('TruthDone records history and advances the round', () => {
    const s = seedAtTruth();
    const next = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
    expect(next.round).toBe(s.round + 1);
    expect(next.roundPhase).toBe('rolling');
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({
      round: s.round,
      loserIndex: s.loserIndex,
      truthId: s.currentTruth!.id,
    });
    expect(next.currentTruth).toBeNull();
    expect(next.loserIndex).toBe(-1);
  });

  it('history preserves the dice totals of that round', () => {
    const s = seedAtTruth();
    const next = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
    expect(next.history[0].totals).toEqual(s.players.map((p) => diceTotal(p.dice)));
  });

  it('scores carry across rounds', () => {
    const s = seedAtTruth();
    const scoresBefore = s.players.map((p) => p.score);
    const next = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
    expect(next.players.map((p) => p.score)).toEqual(scoresBefore);
  });
});

describe('full game playthrough', () => {
  /** 全自动打完一局，返回终局状态。 */
  function playFullGame(seed: number, targetRounds: number): GameState {
    let s = startNewGame({ seed, targetRounds });
    let guard = 0;
    while (s.phase === 'playing') {
      if (++guard > 500) throw new Error('game did not terminate');
      if (s.roundPhase === 'rolling') {
        const idx = s.players.findIndex((p) => !p.hasRolled);
        s = applyAction(s, { type: 'Roll', playerIndex: idx });
      } else if (s.roundPhase === 'tie') {
        s = applyAction(s, { type: 'ResetTie', playerIndex: 0 });
      } else if (s.roundPhase === 'picking') {
        s = applyAction(s, {
          type: 'PickTruth',
          playerIndex: winnerIndex(s),
          choiceIndex: 0,
        });
      } else if (s.roundPhase === 'truth') {
        s = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
      } else {
        break;
      }
    }
    return s;
  }

  it('terminates with the right number of rounds recorded', () => {
    const s = playFullGame(99, 5);
    expect(s.phase).toBe('gameOver');
    expect(s.history).toHaveLength(5);
    expect(s.history.map((h) => h.round)).toEqual([1, 2, 3, 4, 5]);
  });

  it('total score equals the number of decisive rounds', () => {
    const s = playFullGame(99, 5);
    const total = s.players.reduce((sum, p) => sum + p.score, 0);
    expect(total).toBe(5);
  });

  it('no action mutates state after game over', () => {
    const s = playFullGame(99, 5);
    expect(applyAction(s, { type: 'Roll', playerIndex: 0 })).toBe(s);
    expect(applyAction(s, { type: 'TruthDone', playerIndex: 0 })).toBe(s);
    expect(applyAction(s, { type: 'ResetTie', playerIndex: 0 })).toBe(s);
  });

  it('the same seed replays identically', () => {
    const a = playFullGame(2024, 7);
    const b = playFullGame(2024, 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('survives many seeds without crashing', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const s = playFullGame(seed, 7);
      expect(s.phase).toBe('gameOver');
      expect(s.history).toHaveLength(7);
    }
  });

  it('never repeats a truth within a game shorter than the deck', () => {
    const s = playFullGame(555, 10);
    const ids = s.history.map((h) => h.truthId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('truth library integrity', () => {
  const ALL_LEVELS = TRUTH_CATEGORIES;

  it('every deck has unique ids and non-empty text', () => {
    for (const level of ALL_LEVELS) {
      const deck = getTruthDeck(level);
      expect(deck.length).toBeGreaterThan(10);
      expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
      for (const c of deck) {
        expect(c.text.trim().length).toBeGreaterThan(0);
        expect(c.category).toBe(level);
      }
    }
  });

  it('ids are unique across all decks', () => {
    const all = ALL_LEVELS.flatMap((l) => getTruthDeck(l).map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('no duplicate question text across the whole library', () => {
    const texts = ALL_LEVELS.flatMap((l) => getTruthDeck(l).map((c) => c.text));
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
    expect(dupes).toEqual([]);
  });

  it('every question actually asks something', () => {
    // 不强制以问号结尾：有些题故意用「…？说实话。」这种催答收尾
    for (const level of ALL_LEVELS) {
      for (const c of getTruthDeck(level)) {
        expect(c.text).toMatch(/[？?]/);
      }
    }
  });

  it('ALL_TRUTHS covers every category and is big enough to draw from', () => {
    expect(ALL_TRUTHS.length).toBe(
      ALL_LEVELS.reduce((n, l) => n + getTruthDeck(l).length, 0),
    );
    expect(ALL_TRUTHS.length).toBeGreaterThan(TRUTH_CHOICE_COUNT * 10);
    for (const level of ALL_LEVELS) {
      expect(ALL_TRUTHS.some((c) => c.category === level)).toBe(true);
    }
  });

  it('random draws reach across categories, not just one', () => {
    // 纯随机抽题应该摸到多个分类；只碰到一两个说明抽样有偏
    const seenCategories = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = rollBoth(startNewGame({ seed, targetRounds: 3 }));
      for (const c of s.truthChoices) seenCategories.add(c.category);
    }
    expect(seenCategories.size).toBeGreaterThan(4);
  });
});
