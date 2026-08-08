import type { SpiceLevel } from '../types/game.js';

export const PLAYER_COUNT = 2;
export const DICE_PER_ROLL = 2;
export const DICE_FACES = 6;

export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 20;
export const DEFAULT_ROUNDS = 7;

export const DEFAULT_SPICE_LEVEL: SpiceLevel = 'flirty';

export const SPICE_LABELS: Record<SpiceLevel, string> = {
  sweet: '微甜',
  flirty: '暧昧',
  heart: '心动',
};

export const SPICE_HINTS: Record<SpiceLevel, string> = {
  sweet: '回忆与心动瞬间，睡前刚好',
  flirty: '开始撩了，注意脸红',
  heart: '很直接，慎选',
};

/** 每轮输家可以换题的次数 */
export const TRUTH_REROLLS_PER_ROUND = 1;

/** 断线重连窗口（秒） */
export const RECONNECT_WINDOW_SECONDS = 90;
