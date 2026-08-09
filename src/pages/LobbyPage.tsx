import { motion } from 'framer-motion';
import type { SpiceLevel } from '@game/shared/types';
import { MAX_ROUNDS, MIN_ROUNDS, SPICE_HINTS, SPICE_LABELS } from '@game/shared/constants';
import { useOnlineStore } from '../store/onlineStore';
import { DeckPicker } from '../components/DeckPicker';

/**
 * 等待室。★ 客人也要能看到房主设的配置（playbook §11 清单最后一项），
 * 否则进来一脸懵不知道要打几轮、什么尺度。
 */
export function LobbyPage() {
  const room = useOnlineStore((s) => s.room);
  const startGame = useOnlineStore((s) => s.startGame);
  const updateConfig = useOnlineStore((s) => s.updateConfig);
  const leave = useOnlineStore((s) => s.leave);

  if (!room) return null;

  const bothHere = room.players.length >= 2;
  const spice = room.spiceLevel as SpiceLevel;

  return (
    <div className="relative z-10 mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-center">
          <p className="text-xs tracking-[0.3em] text-blush/50">房号</p>
          <p className="mt-1 font-mono text-5xl tracking-[0.25em] text-gold">{room.roomId}</p>
          <p className="mt-2 text-sm text-blush/60">
            {room.isHost ? '把这四个数字告诉她' : '等房主开始'}
          </p>
        </div>

        <div className="mt-7 space-y-2.5">
          {[0, 1].map((idx) => {
            const p = room.players.find((x) => x.playerIndex === idx);
            const isMe = idx === room.myPlayerIndex;
            return (
              <div
                key={idx}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 ${
                  p
                    ? 'border-blush/25 bg-night-2/70'
                    : 'border-dashed border-blush/15 bg-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-xl">{p ? (idx === 0 ? '💗' : '💞') : '🕯'}</span>
                  <span className={p ? 'text-white' : 'text-blush/40'}>
                    {p ? p.nickname : '等她进来…'}
                  </span>
                  {isMe && <span className="text-xs text-gold/70">（你）</span>}
                </span>
                {p && !p.connected && <span className="text-xs text-gold/70">断线中</span>}
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-blush/20 bg-night-2/60 p-4">
          {room.isHost ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-xs tracking-wider text-blush/60">玩几轮</span>
                <span className="text-sm text-gold">{room.targetRounds} 轮</span>
              </div>
              <input
                type="range"
                min={MIN_ROUNDS}
                max={MAX_ROUNDS}
                value={room.targetRounds}
                onChange={(e) => updateConfig({ targetRounds: Number(e.target.value) })}
                className="mt-2 w-full accent-rose"
              />
              <div className="mt-4">
                <DeckPicker
                  value={spice}
                  onChange={(lv) => updateConfig({ spiceLevel: lv })}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-around text-center">
              <div>
                <p className="text-xs tracking-wider text-blush/50">轮数</p>
                <p className="mt-1 text-lg text-gold">{room.targetRounds} 轮</p>
              </div>
              <div className="h-8 w-px bg-blush/15" />
              <div>
                <p className="text-xs tracking-wider text-blush/50">尺度</p>
                <p className="mt-1 text-lg text-gold">{SPICE_LABELS[spice]}</p>
              </div>
            </div>
          )}
          <p className="mt-3 text-center text-xs text-blush/45">{SPICE_HINTS[spice]}</p>
        </div>

        {room.isHost && (
          <button
            disabled={!bothHere}
            onClick={startGame}
            className={`mt-6 w-full rounded-2xl py-4 text-base font-medium text-white shadow-lg transition disabled:opacity-35 ${
              bothHere ? 'glow-pulse bg-gradient-to-r from-rose to-wine' : 'bg-wine/50'
            }`}
          >
            {bothHere ? '开始' : '等她进来…'}
          </button>
        )}

        <button
          onClick={() => void leave()}
          className="mt-3 w-full py-2 text-xs text-blush/40"
        >
          离开房间
        </button>
      </motion.div>
    </div>
  );
}
