import { motion } from 'framer-motion';
import { leaderIndex } from '@game/shared/game-engine';
import { useOnlineStore } from '../store/onlineStore';

export function GameOverPage() {
  const room = useOnlineStore((s) => s.room);
  const snapshot = useOnlineStore((s) => s.snapshot);
  const playAgain = useOnlineStore((s) => s.playAgain);
  const leave = useOnlineStore((s) => s.leave);

  if (!room || !snapshot) return null;

  const me = room.myPlayerIndex;
  const winner = leaderIndex(snapshot);
  const iWon = winner === me;
  const tied = winner === -1;

  return (
    <div className="relative z-10 mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 18 }}
        className="text-center"
      >
        <div className="text-5xl">{tied ? '💞' : iWon ? '👑' : '💗'}</div>
        <h2 className="mt-3 font-serif-cn text-2xl text-blush">
          {tied ? '打成平手' : iWon ? '你赢了' : `${snapshot.players[winner].nickname} 赢了`}
        </h2>
        <p className="mt-2 text-sm text-blush/55">
          {tied
            ? '这么般配，那今晚都别想跑'
            : iWon
              ? '她欠你的，记得讨回来'
              : '认罚吧，愿赌服输'}
        </p>

        <div className="mt-6 flex items-center justify-center gap-5">
          {snapshot.players.map((p, i) => (
            <div key={i} className="text-center">
              <p className="text-xs text-blush/50">{p.nickname}</p>
              <p className="mt-1 text-3xl text-gold">{p.score}</p>
              <p className="text-xs text-blush/40">赢了几轮</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 回顾：这局问过什么 */}
      <div className="mt-7 max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-blush/15 bg-night-2/50 p-4">
        <p className="mb-1 text-xs tracking-wider text-blush/50">这一局你们问过</p>
        {snapshot.history.map((h) => (
          <div key={h.round} className="border-b border-blush/10 pb-2 last:border-0">
            <p className="text-xs text-blush/40">
              第 {h.round} 轮 · {snapshot.players[h.loserIndex]?.nickname} 答
              <span className="ml-1.5">
                {h.totals[0]} : {h.totals[1]}
              </span>
            </p>
            <p className="mt-0.5 text-sm leading-snug text-blush/80">{h.truthText}</p>
          </div>
        ))}
      </div>

      {room.isHost ? (
        <button
          onClick={playAgain}
          className="mt-6 w-full rounded-2xl bg-gradient-to-r from-rose to-wine py-4 text-base font-medium text-white shadow-lg"
        >
          再来一局
        </button>
      ) : (
        <p className="mt-6 text-center text-sm text-blush/50">等房主再开一局…</p>
      )}

      <button onClick={() => void leave()} className="mt-3 w-full py-2 text-xs text-blush/40">
        结束，离开房间
      </button>
    </div>
  );
}
