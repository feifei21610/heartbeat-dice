/**
 * 命令行对局模拟器（playbook §7.4）。
 *
 *   npx tsx scripts/simulate-game.ts <seed> [rounds] [--verbose]
 *
 * 用途：跑几百个 seed 找引擎崩溃、复现用户报的局面。
 * 因为 §2.4 的 seeded RNG，同一个 seed 永远得到同一局。
 */
import {
  applyAction,
  diceTotal,
  leaderIndex,
  startNewGame,
  winnerIndex,
} from '../packages/shared/src/game-engine/index.js';
import type { GameState } from '../packages/shared/src/types/game.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const positional = args.filter((a) => !a.startsWith('--'));
const seed = Number(positional[0] ?? 1);
const rounds = Number(positional[1] ?? 7);

function play(state: GameState, log: (s: string) => void): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'playing') {
    if (++guard > 1000) throw new Error(`seed ${seed}: game did not terminate`);

    if (s.roundPhase === 'rolling') {
      const idx = s.players.findIndex((p) => !p.hasRolled);
      s = applyAction(s, { type: 'Roll', playerIndex: idx });
      const p = s.players[idx];
      if (p.dice) {
        log(`  ${p.nickname} 掷出 ${p.dice[0]} + ${p.dice[1]} = ${diceTotal(p.dice)}`);
      }
    } else if (s.roundPhase === 'tie') {
      log('  平局，重掷');
      s = applyAction(s, { type: 'ResetTie', playerIndex: 0 });
    } else if (s.roundPhase === 'picking') {
      // 模拟器里赢家一律挑第一道，保证可复现
      const w = winnerIndex(s);
      log(`  ${s.players[w].nickname} 赢，候选：`);
      s.truthChoices.forEach((c, i) => log(`    ${i + 1}. ${c.text}`));
      s = applyAction(s, { type: 'PickTruth', playerIndex: w, choiceIndex: 0 });
    } else if (s.roundPhase === 'truth') {
      const loser = s.players[s.loserIndex];
      log(`  → ${loser.nickname} 要答：${s.currentTruth?.text}`);
      s = applyAction(s, { type: 'TruthDone', playerIndex: s.loserIndex });
      if (s.phase === 'playing') log(`\n第 ${s.round} 轮`);
    } else {
      break;
    }
  }
  return s;
}

const log = verbose ? (m: string) => console.log(m) : () => {};

const initial = startNewGame({ seed, targetRounds: rounds, nicknames: ['tangni', 'harriet'] });
log(`seed=${seed} rounds=${rounds}\n\n第 1 轮`);

const final = play(initial, log);
const winner = leaderIndex(final);

console.log(
  `seed=${seed} 打完 ${final.history.length} 轮 · ` +
    final.players.map((p) => `${p.nickname} ${p.score}`).join(' / ') +
    ` · ${winner === -1 ? '平手' : `${final.players[winner].nickname} 赢`}`,
);
