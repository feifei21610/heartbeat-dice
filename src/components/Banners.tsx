import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

/**
 * ★ 错误提示条。联机项目的第一个 UI 组件（playbook §4）：
 *   服务端拒绝动作时必须让用户看见，不能只 console.error。
 */
export function ErrorBar({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-3"
        >
          <button
            onClick={onDismiss}
            className="rounded-full border border-rose/50 bg-wine/90 px-5 py-2.5 text-sm text-white shadow-lg backdrop-blur"
          >
            {message}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 一次性播报，比 ErrorBar 温和 */
export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 2600);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed bottom-6 left-0 right-0 z-40 flex justify-center px-4"
        >
          <div className="rounded-full border border-blush/25 bg-night-2/90 px-4 py-2 text-xs text-blush/90 backdrop-blur">
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 重连提示条。重连期间保留牌桌画面 + 叠一条提示（playbook §5.2 第 3 点），
 * 不跳走、不白屏 —— 跳走等于告诉用户「你输了」。
 *
 * ★ 但必须给一个「不等了」的出口：自动重连只试几次，
 *   万一卡住，用户能自己点掉回首页重开，而不是干瞪着转圈。
 */
export function ReconnectingBanner({
  attempt,
  total,
  onGiveUp,
}: {
  attempt: number;
  total: number;
  onGiveUp: () => void;
}) {
  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-3"
    >
      <div className="flex items-center gap-3 rounded-full border border-gold/40 bg-night-2/95 px-5 py-2.5 text-sm text-gold shadow-lg backdrop-blur">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          className="inline-block"
        >
          ✦
        </motion.span>
        <span>
          连接断了，正在重连
          {attempt > 0 && (
            <span className="opacity-60">
              {' '}
              {attempt}/{total}
            </span>
          )}
        </span>
        <button
          onClick={onGiveUp}
          className="ml-1 rounded-full border border-gold/40 px-3 py-1 text-xs text-gold/90"
        >
          不等了
        </button>
      </div>
    </motion.div>
  );
}
