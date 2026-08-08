import { ArraySchema, Schema, type } from '@colyseus/schema';

/**
 * Colyseus Schema —— 房间的**持续性公共状态**。
 *
 * ★ 划分原则（playbook §3.2）：
 *   - 持续性公共配置/状态 → 放这里（重连客户端自动拿到）
 *   - 一次性事件（动作播报、结算） → 走 broadcast/send 消息
 *   - 两边都需要的字段 → 两边都要写
 *
 * ★ 本游戏没有隐藏信息（骰子点数双方都该看到、题目双方都该看到），
 *   所以不需要 privateHand 那套。若以后加手牌，务必只放数量。
 *
 * ★ 加字段的清单（playbook §11）：
 *   引擎 options 类型 → 这里 → onCreate 读取并钳制 → 传给引擎
 *   → buildSnapshot → 客户端 network interface → store → 创建房间 UI → 等待室显示
 */

export class PlayerSchema extends Schema {
  @type('string') sessionId = '';
  @type('string') nickname = '';
  @type('number') score = 0;
  @type('boolean') connected = true;
  @type('boolean') hasRolled = false;
  /** 座位索引，对应 GameState.players 的下标 */
  @type('number') playerIndex = 0;
}

export class GameRoomState extends Schema {
  /** 'lobby' | 'playing' | 'gameOver' —— 房间层面的相位 */
  @type('string') roomPhase = 'lobby';
  @type('string') hostSessionId = '';

  /** 房间配置：来自客户端但一律钳制 */
  @type('number') targetRounds = 7;
  @type('string') spiceLevel = 'flirty';

  @type('number') round = 1;
  @type([PlayerSchema]) players = new ArraySchema<PlayerSchema>();
}
