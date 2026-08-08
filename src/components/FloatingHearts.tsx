import { useMemo } from 'react';

/** 背景飘心。纯装饰，位置用固定伪随机避免每次渲染跳动。 */
export function FloatingHearts({ count = 14 }: { count?: number }) {
  const hearts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (i * 2654435761) % 1000 / 1000;
        const r2 = (i * 40503 + 17) % 1000 / 1000;
        return {
          left: `${4 + r * 92}%`,
          size: 10 + r2 * 16,
          duration: 11 + r * 13,
          delay: -r2 * 18,
          char: i % 3 === 0 ? '♥' : i % 3 === 1 ? '💗' : '✦',
        };
      }),
    [count],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {hearts.map((h, i) => (
        <span
          key={i}
          className="heart-float absolute bottom-0 text-rose/40"
          style={{
            left: h.left,
            fontSize: `${h.size}px`,
            animationDuration: `${h.duration}s`,
            animationDelay: `${h.delay}s`,
          }}
        >
          {h.char}
        </span>
      ))}
    </div>
  );
}
