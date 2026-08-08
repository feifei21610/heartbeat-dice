/**
 * Seeded RNG —— 不要在项目任何地方直接调 Math.random()。
 *
 * 采用 mulberry32：状态只有一个 32 位整数，可以完整存进 GameState
 * （seed + rngCursor），因此任意时刻的随机序列都能精确复现。
 * 这是「用户报 bug 只需给 seed」和「服务端权威校验」的基础。
 */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, max) 的整数 */
  nextInt(max: number): number;
  /** 已消耗的随机数个数 */
  cursor(): number;
}

function mulberry32(a: number) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从 seed 建 RNG，并快进 cursor 步。
 * 重连补发状态时用 (state.seed, state.rngCursor) 重建，序列不会错位。
 */
export function createRng(seed: number, cursor = 0): Rng {
  const raw = mulberry32(seed >>> 0);
  let used = 0;
  for (let i = 0; i < cursor; i++) raw();
  return {
    next() {
      used++;
      return raw();
    },
    nextInt(max: number) {
      return Math.floor(this.next() * max);
    },
    cursor() {
      return cursor + used;
    },
  };
}

/** 随机 seed —— 只在「开新局」这一个地方允许调用宿主随机源。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
