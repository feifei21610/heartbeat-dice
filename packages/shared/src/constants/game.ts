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
  memory: '记忆',
  daily: '日常',
  feelings: '情绪',
  past: '过往',
  values: '三观',
  future: '未来',
};

export const SPICE_HINTS: Record<SpiceLevel, string> = {
  sweet: '回忆与心动瞬间，睡前刚好',
  flirty: '开始撩了，注意脸红',
  heart: '很直接，慎选',
  memory: '初识、第一印象、我们一起走过的',
  daily: '相处模式、生活习惯、那些小事',
  feelings: '偏爱、安全感、说不出口的情绪',
  past: '成长故事、旧事、遗憾',
  values: '底线、原则、对感情的看法',
  future: '规划、想象、对以后的期许',
};

/** 断线重连窗口（秒） */
export const RECONNECT_WINDOW_SECONDS = 90;
