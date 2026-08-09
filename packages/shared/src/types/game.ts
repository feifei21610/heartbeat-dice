/**
 * 心动骰 —— 游戏状态与动作类型定义
 *
 * 这里是规则的唯一真相来源之一（另一半在 game-engine/）。
 * 所有类型必须可 JSON 序列化：它们要经过 WebSocket。
 */

/**
 * 题目的话题分类。
 *
 * ★ 这只是给题目打的标签，用于组织题库和历史记录 —— 玩家不选分类，
 *   抽题是从全部题目里纯随机抽（见 drawTruthChoices）。
 *   前端也不展示分类。
 */
export type TruthCategory =
  | 'sweet'
  | 'flirty'
  | 'heart'
  | 'memory'
  | 'daily'
  | 'feelings'
  | 'past'
  | 'values'
  | 'future';

export const TRUTH_CATEGORIES = [
  'sweet',
  'flirty',
  'heart',
  'memory',
  'daily',
  'feelings',
  'past',
  'values',
  'future',
] as const;

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
  /** 赢家正在从候选里挑一道题给输家 */
  | 'picking'
  /** 输家在回答赢家挑的那道题 */
  | 'truth'
  /** 平局，需要重掷 */
  | 'tie';

export type GamePhase = 'playing' | 'gameOver';

export interface TruthCard {
  id: string;
  text: string;
  category: TruthCategory;
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

  /** 本轮输家索引；未判定时为 -1 */
  loserIndex: number;
  /** 赢家可挑的候选题（picking 阶段有值）。两边都看得到。 */
  truthChoices: TruthCard[];
  /** 赢家挑定的那道题；未挑时为 null */
  currentTruth: TruthCard | null;
  /** 已经用过的题目 id，避免重复 */
  usedTruthIds: string[];

  history: RoundRecord[];
}

export type Action =
  /** 掷骰子。playerIndex 由服务端按 session 填，客户端传的会被忽略 */
  | { type: 'Roll'; playerIndex: number }
  /** 赢家挑定一道题（choiceIndex 指向 truthChoices） */
  | { type: 'PickTruth'; playerIndex: number; choiceIndex: number }
  /** 输家答完了，进入下一轮 */
  | { type: 'TruthDone'; playerIndex: number }
  /** 平局后重掷 */
  | { type: 'ResetTie'; playerIndex: number };

export interface GameOptions {
  targetRounds: number;
  seed: number;
  nicknames: [string, string];
}
