import { motion } from 'framer-motion';

/** 骰子点数的点位布局 */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [26, 26],
    [50, 50],
    [74, 74],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 25],
    [72, 25],
    [28, 50],
    [72, 50],
    [28, 75],
    [72, 75],
  ],
};

export function Die({
  value,
  rolling,
  delay = 0,
}: {
  value: number | null;
  rolling?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, rotate: -25 }}
      animate={
        rolling
          ? { scale: 1, opacity: 1, rotate: [0, 90, 180, 270, 360] }
          : { scale: 1, opacity: 1, rotate: 0 }
      }
      transition={
        rolling
          ? { rotate: { duration: 0.7, repeat: Infinity, ease: 'linear' }, delay }
          : { type: 'spring', stiffness: 260, damping: 18, delay }
      }
      className="relative h-16 w-16 rounded-2xl border border-white/25 bg-gradient-to-br from-white/95 to-blush/40 shadow-[0_6px_20px_-4px_rgba(255,92,138,0.6)] sm:h-20 sm:w-20"
    >
      {value !== null &&
        !rolling &&
        PIPS[value]?.map(([x, y], i) => (
          <span
            key={i}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-wine sm:h-3 sm:w-3"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
      {(value === null || rolling) && (
        <span className="absolute inset-0 flex items-center justify-center text-2xl text-wine/50">
          ?
        </span>
      )}
    </motion.div>
  );
}

export function DicePair({
  dice,
  rolling,
}: {
  dice: [number, number] | null;
  rolling?: boolean;
}) {
  return (
    <div className="flex gap-2.5 sm:gap-3">
      <Die value={dice?.[0] ?? null} rolling={rolling} />
      <Die value={dice?.[1] ?? null} rolling={rolling} delay={0.08} />
    </div>
  );
}
