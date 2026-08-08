import { AnimatePresence, motion } from 'framer-motion';
import { diceTotal } from '@game/shared/game-engine';
import { SPICE_LABELS } from '@game/shared/constants';
import type { SpiceLevel } from '@game/shared/types';
import { useOnlineStore } from '../store/onlineStore';
import { DicePair } from '../components/Dice';

/**
 * 牌桌。★ UI 里一行游戏逻辑都不写（playbook §2.1）：
 *   「能不能掷」由服务端拒绝 + 本地 disabled 表达，
 *   不做乐观更新（playbook §3.1），按钮 disabled 就是防手感发虚的正确做法。
 */
export function GamePage() {
  const room = useOnlineStore((s) => s.room);
  const snapshot = useOnlineStore((s) => s.snapshot);
  const roll = useOnlineStore((s) => s.roll);
  const truthDone = useOnlineStore((s) => s.truthDone);
  const rerollTruth = useOnlineStore((s) => s.rerollTruth);
  const resetTie = useOnlineStore((s) => s.resetTie);

  if (!room || !snapshot) {
    return (
      <div className="relative z-10 flex min-h-full items-center justify-center">
        <p className="text-blush/50">正在把牌桌摆好…</p>
      </div>
    );
  }

  const me = room.myPlayerIndex;
  const other = me === 0 ? 1 : 0;
  const myP = snapshot.players[me];
  const otherP = snapshot.players[other];
  if (!myP || !otherP) return null;

  const { roundPhase, loserIndex, currentTruth } = snapshot;
  const iAmLoser = loserIndex === me;
  const waitingForOther = roundPhase === 'rolling' && myP.hasRolled && !otherP.hasRolled;

  return (
    <div className="relative z-10 mx-auto flex min-h-full max-w-md flex-col px-4 py-5">
      {/* 顶部：轮次 + 比分 */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-blush/60">
          第 <span className="text-gold">{snapshot.round}</span> / {snapshot.targetRounds} 轮
        </span>
        <span className="text-xs text-blush/40">
          {SPICE_LABELS[snapshot.spiceLevel as SpiceLevel]}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-3 rounded-2xl border border-blush/15 bg-night-2/50 py-2.5">
        <ScoreChip name={myP.nickname} score={myP.score} me />
        <span className="text-blush/30">·</span>
        <ScoreChip name={otherP.nickname} score={otherP.score} offline={!otherP.connected} />
      </div>

      {/* 对方 */}
      <div className="mt-6 flex flex-col items-center">
        <p className="mb-2.5 text-sm text-blush/70">
          {otherP.nickname}
          {!otherP.connected && <span className="ml-1.5 text-xs text-gold/70">断线中</span>}
        </p>
        <DicePair dice={otherP.dice} rolling={roundPhase === 'rolling' && !otherP.hasRolled} />
        <TotalLabel dice={otherP.dice} show={otherP.hasRolled} />
      </div>

      {/* 中间：状态 / 真心话 */}
      <div className="my-5 min-h-[132px] flex-1">
        <AnimatePresence mode="wait">
          {roundPhase === 'rolling' && (
            <motion.div
              key="rolling"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full items-center justify-center"
            >
              <p className="text-center text-sm leading-relaxed text-blush/50">
                {waitingForOther
                  ? `等 ${otherP.nickname} 摇…`
                  : myP.hasRolled
                    ? '等对方'
                    : '摇一个，小的人认罚'}
              </p>
            </motion.div>
          )}

          {roundPhase === 'tie' && (
            <motion.div
              key="tie"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full flex-col items-center justify-center gap-3"
            >
              <p className="text-lg text-gold">一样大，这么有默契</p>
              <button
                onClick={resetTie}
                className="rounded-full border border-gold/40 px-6 py-2.5 text-sm text-gold"
              >
                再摇一次
              </button>
            </motion.div>
          )}

          {roundPhase === 'truth' && currentTruth && (
            <motion.div
              key={currentTruth.id}
              initial={{ opacity: 0, y: 16, rotateX: -12 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="rounded-3xl border border-rose/40 bg-gradient-to-br from-wine/60 to-night-2/80 p-5 shadow-[0_10px_40px_-12px_rgba(255,92,138,0.6)]"
            >
              <p className="text-center text-xs tracking-[0.25em] text-blush/50">
                {iAmLoser ? '你输了，老实回答' : `${otherP.nickname} 要回答`}
              </p>
              <p className="mt-3.5 text-center font-serif-cn text-xl leading-relaxed text-white">
                {currentTruth.text}
              </p>

              {iAmLoser && (
                <div className="mt-5 flex gap-2.5">
                  <button
                    disabled={snapshot.truthRerollsLeft <= 0}
                    onClick={rerollTruth}
                    className="rounded-2xl border border-blush/30 px-4 py-2.5 text-sm text-blush/80 disabled:opacity-30"
                  >
                    换一题
                    {snapshot.truthRerollsLeft > 0 && (
                      <span className="ml-1 text-xs opacity-60">
                        ×{snapshot.truthRerollsLeft}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={truthDone}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-rose to-wine py-2.5 text-sm font-medium text-white"
                  >
                    我说完了
                  </button>
                </div>
              )}
              {!iAmLoser && (
                <p className="mt-4 text-center text-xs text-blush/45">
                  听她说完，然后她点「说完了」
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 我 */}
      <div className="flex flex-col items-center">
        <TotalLabel dice={myP.dice} show={myP.hasRolled} />
        <DicePair dice={myP.dice} rolling={false} />
        <p className="mt-2.5 text-sm text-blush/70">{myP.nickname}（你）</p>
      </div>

      {/* 动作区 */}
      <div className="mt-5">
        <button
          disabled={roundPhase !== 'rolling' || myP.hasRolled}
          onClick={roll}
          className={`w-full rounded-2xl py-4 text-base font-medium text-white shadow-lg transition disabled:opacity-30 ${
            roundPhase === 'rolling' && !myP.hasRolled
              ? 'glow-pulse bg-gradient-to-r from-rose to-wine'
              : 'bg-wine/40'
          }`}
        >
          {myP.hasRolled ? '已经摇了' : '摇骰子'}
        </button>
      </div>
    </div>
  );
}

/** ★ 数值旁边一定要有文字标签（playbook §10）：纯图标新手看不懂 */
function ScoreChip({
  name,
  score,
  me,
  offline,
}: {
  name: string;
  score: number;
  me?: boolean;
  offline?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5 text-sm">
      <span className={me ? 'text-blush' : 'text-blush/70'}>{name}</span>
      <span className="text-xs text-blush/40">赢了</span>
      <span className="text-base text-gold">{score}</span>
      <span className="text-xs text-blush/40">次</span>
      {offline && <span className="text-xs text-gold/60">·断</span>}
    </span>
  );
}

function TotalLabel({ dice, show }: { dice: [number, number] | null; show: boolean }) {
  return (
    <div className="h-7 pt-1.5">
      {show && dice && (
        <motion.p
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-sm text-blush/60"
        >
          合计 <span className="text-lg text-gold">{diceTotal(dice)}</span>
        </motion.p>
      )}
    </div>
  );
}
