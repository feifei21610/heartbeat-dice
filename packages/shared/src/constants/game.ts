export const PLAYER_COUNT = 2;
export const DICE_PER_ROLL = 2;
export const DICE_FACES = 6;

export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 20;
export const DEFAULT_ROUNDS = 7;

/** 赢家能挑的候选题数量 */
export const TRUTH_CHOICE_COUNT = 4;

/** 断线重连窗口（秒） */
export const RECONNECT_WINDOW_SECONDS = 90;

/**
 * 客户端自动重连的尝试次数。
 * ★ 别调太大：拉不回来就该放人走，让用户自己重开，
 *   卡在「正在把你拉回来」比直接回首页更让人恼火。
 */
export const RECONNECT_MAX_ATTEMPTS = 4;
