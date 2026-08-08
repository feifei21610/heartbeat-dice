import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { SpiceLevel } from '@game/shared/types';
import {
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
  MIN_ROUNDS,
  SPICE_HINTS,
  SPICE_LABELS,
} from '@game/shared/constants';
import { useOnlineStore } from '../store/onlineStore';

const SPICE_ORDER: SpiceLevel[] = ['sweet', 'flirty', 'heart'];

export function HomePage() {
  const createRoom = useOnlineStore((s) => s.createRoom);
  const joinRoom = useOnlineStore((s) => s.joinRoom);
  const phase = useOnlineStore((s) => s.phase);

  const [mode, setMode] = useState<'pick' | 'create' | 'join'>('pick');
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [spice, setSpice] = useState<SpiceLevel>('flirty');

  // 记住昵称，下次不用重打
  useEffect(() => {
    const saved = localStorage.getItem('hd.lastNickname');
    if (saved) setNickname(saved);
  }, []);

  const connecting = phase === 'connecting';
  const canGo = nickname.trim().length > 0;

  function remember() {
    localStorage.setItem('hd.lastNickname', nickname.trim());
  }

  return (
    <div className="relative z-10 mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <div className="mb-2 text-5xl">💗</div>
        <h1 className="font-serif-cn text-3xl leading-tight tracking-wide text-blush">
          tangni <span className="text-rose">&</span> harriet
        </h1>
        <p className="mt-1 font-serif-cn text-lg text-gold/80">'s mini game</p>
        <p className="mt-4 text-sm leading-relaxed text-blush/60">
          轮流摇骰子 · 点数小的那个人
          <br />
          要老实回答一个问题
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="mt-8 rounded-3xl border border-blush/20 bg-night-2/70 p-5 backdrop-blur"
      >
        <label className="block text-xs tracking-wider text-blush/60">你的名字</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 12))}
          placeholder="怎么称呼你"
          className="mt-2 w-full rounded-2xl border border-blush/25 bg-night/60 px-4 py-3 text-center text-lg text-white placeholder:text-blush/30 focus:border-rose focus:outline-none"
        />

        {mode === 'pick' && (
          <div className="mt-5 space-y-3">
            <button
              disabled={!canGo}
              onClick={() => setMode('create')}
              className="w-full rounded-2xl bg-gradient-to-r from-rose to-wine py-3.5 text-base font-medium text-white shadow-lg transition disabled:opacity-35"
            >
              我来开一局
            </button>
            <button
              disabled={!canGo}
              onClick={() => setMode('join')}
              className="w-full rounded-2xl border border-blush/30 bg-transparent py-3.5 text-base text-blush transition disabled:opacity-35"
            >
              我有房号，加入她
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs tracking-wider text-blush/60">玩几轮</span>
                <span className="text-sm text-gold">{rounds} 轮</span>
              </div>
              <input
                type="range"
                min={MIN_ROUNDS}
                max={MAX_ROUNDS}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                className="mt-2 w-full accent-rose"
              />
            </div>

            <div>
              <span className="text-xs tracking-wider text-blush/60">尺度</span>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {SPICE_ORDER.map((lv) => (
                  <button
                    key={lv}
                    onClick={() => setSpice(lv)}
                    className={`rounded-xl border py-2.5 text-sm transition ${
                      spice === lv
                        ? 'border-rose bg-rose/20 text-white'
                        : 'border-blush/20 text-blush/60'
                    }`}
                  >
                    {SPICE_LABELS[lv]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-center text-xs text-blush/50">{SPICE_HINTS[spice]}</p>
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setMode('pick')}
                className="rounded-2xl border border-blush/25 px-5 py-3 text-sm text-blush/70"
              >
                返回
              </button>
              <button
                disabled={connecting}
                onClick={() => {
                  remember();
                  void createRoom(nickname.trim(), rounds, spice);
                }}
                className="flex-1 rounded-2xl bg-gradient-to-r from-rose to-wine py-3 text-base font-medium text-white shadow-lg disabled:opacity-50"
              >
                {connecting ? '开房中…' : '开房，等她进来'}
              </button>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs tracking-wider text-blush/60">房号</label>
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 位数字"
                inputMode="numeric"
                className="mt-2 w-full rounded-2xl border border-blush/25 bg-night/60 px-4 py-3 text-center text-2xl tracking-[0.4em] text-white placeholder:text-base placeholder:tracking-normal placeholder:text-blush/30 focus:border-rose focus:outline-none"
              />
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setMode('pick')}
                className="rounded-2xl border border-blush/25 px-5 py-3 text-sm text-blush/70"
              >
                返回
              </button>
              <button
                disabled={connecting || roomCode.length !== 4}
                onClick={() => {
                  remember();
                  void joinRoom(nickname.trim(), roomCode);
                }
                }
                className="flex-1 rounded-2xl bg-gradient-to-r from-rose to-wine py-3 text-base font-medium text-white shadow-lg disabled:opacity-40"
              >
                {connecting ? '连接中…' : '进去'}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      <p className="mt-6 text-center text-xs leading-relaxed text-blush/35">
        两个人各摇两颗骰子，加起来小的那个人抽一题
        <br />
        不许赖账 · 不许换题两次
      </p>
    </div>
  );
}
