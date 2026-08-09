/**
 * 心动骰 —— 游戏状态与动作类型定义
 *
 * 这里是规则的唯一真相来源之一（另一半在 game-engine/）。
 * 所有类型必须可 JSON 序列化：它们要经过 WebSocket。
 */

/**
 * 题库档位。前三档按「尺度」分（越靠后越暧昧），
 * 后面几档按「话题领域」分，用来深聊。
 */
export type SpiceLevel =
  // 尺度档
  | 'sweet'
  | 'flirty'
  | 'heart'
  // 深聊档（按领域）
  | 'memory'
  | 'daily'
  | 'feelings'
  | 'past'
  | 'values'
  | 'future';

/** 尺度档：偏调情 */
export const SPICE_LEVELS = ['sweet', 'flirty', 'heart'] as const;
/** 深聊档：偏交心 */
export const DEEP_LEVELS = ['memory', 'daily', 'feelings', 'past', 'values', 'future'] as const;

/** 玩家在一局里的角色。remote = 联机对面那个人。 */
export type PlayerType = 'human' | 'remote';

export interface Player {
  id: string;
  nickname: string;
  type: PlayerType;
  /** 累计得分：赢一轮 +1 */
  score: number;
  /** 本轮掷出的两颗骰子；未掷时为 null */
  dice: [number, number] | null;
  /** 是否已完成本轮投掷 */
  hasRolled: boolean;
  /** 断线标记（仅联机用） */
  connected: boolean;
}

/** 一轮的阶段。 */
export type RoundPhase =
  /** 双方都还没掷完 */
  | 'rolling'
  /** 都掷完了，正在展示点数与胜负 */
  | 'reveal'
  /** 输家在回答真心话 */
  | 'truth'
  /** 平局，需要重掷 */
  | 'tie';

export type GamePhase = 'playing' | 'gameOver';

export interface TruthCard {
  id: string;
  text: string;
  level: SpiceLevel;
}

export interface RoundRecord {
  round: number;
  /** 各玩家点数，按 players 索引 */
  totals: number[];
  /** 输家索引；平局重掷后不会留下记录 */
  loserIndex: number;
  truthId: string;
  truthText: string;
}

export interface GameState {
  /** 随机数种子，保证可复现（见 playbook §2.4） */
  seed: number;
  /** RNG 游标：每次取随机数递增，重连补发状态时靠它对齐序列 */
  rngCursor: number;

  players: Player[];
  /** 第几轮，从 1 开始 */
  round: number;
  /** 打满多少轮结束 */
  targetRounds: number;
  phase: GamePhase;
  roundPhase: RoundPhase;
  spiceLevel: SpiceLevel;

  /** 本轮输家索引；未判定时为 -1 */
  loserIndex: number;
  /** 本轮抽到的真心话；未抽时为 null */
  currentTruth: TruthCard | null;
  /** 已经用过的题目 id，避免重复 */
  usedTruthIds: string[];

  history: RoundRecord[];
}

export type Action =
  /** 掷骰子。playerIndex 由服务端按 session 填，客户端传的会被忽略 */
  | { type: 'Roll'; playerIndex: number }
  /** 输家答完了真心话，进入下一轮 */
  | { type: 'TruthDone'; playerIndex: number }
  /** 换一道题（输家有一次换题机会时用） */
  | { type: 'RerollTruth'; playerIndex: number }
  /** 平局后重掷 */
  | { type: 'ResetTie'; playerIndex: number };

export interface GameOptions {
  targetRounds: number;
  spiceLevel: SpiceLevel;
  seed: number;
  nicknames: [string, string];
}
