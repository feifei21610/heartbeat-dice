# tangni & harriet's mini game — 项目约定

> 给接手的 AI 助手看的。架构约束来自 `multiplayer-board-game-playbook.md`，
> 偏离之前先问用户。

## 是什么

两人联机的情侣小游戏「心动骰」：每轮双方各摇两颗骰子，点数小的人认罚。
**赢家从 4 道随机候选里挑一道，输家回答。** 打满 N 轮，赢的轮数多者胜。

题库 198 题，内部按话题分 9 类，但**抽题是纯随机的**：玩家不选分类，
前端也不展示分类。分类只用于题库维护和覆盖面统计。

## 命令

```bash
npm run dev:all          # 同时起后端(2567) + 前端(5173)
npm test                 # 引擎单测 + 房间集成测试（78 条）
npm run e2e              # Playwright，自动拉起前后端
npm run simulate 42 7 --verbose   # 命令行模拟一局（seed=42, 7 轮）
npm run build            # 前端产物 → dist/
npm run build:server     # 服务端打包 → packages/server/build/index.js
```

## 架构铁律

1. **引擎只有一份源码**：`packages/shared/src/game-engine/`，前端和服务端引用同一份。
   不要在 `src/` 下再放一份「先写快以后再挪」的副本 —— 不会挪的。
2. **引擎是纯函数**，不 import React / DOM / store。UI 组件里一行游戏逻辑都不写。
3. **非法动作返回原对象**（`applyAction(s, a) === s`），不抛异常。
   服务端 `handlePlayerAction` 靠这个恒等判非法。改引擎时务必守住这条契约。
4. **不做乐观更新**。客户端只消费服务端快照；防手感发虚靠按钮 `disabled`。
5. **随机只走 seeded RNG**（`rng.ts`），不许直接 `Math.random()`
   （唯一例外：`randomSeed()` 开新局时）。
6. **phase 由权威数据驱动**，不由「操作成功」驱动。
   `reconnect()` 成功时快照可能还没到，此时切 `playing` 会白屏。

## 一轮的相位流转

```
rolling ──双方掷完──> picking ──赢家挑定──> truth ──输家答完──> 下一轮 / gameOver
        └─点数相同──> tie ──任一方重掷──> rolling
```

`picking` 阶段的 4 道候选放在 `GameState.truthChoices`（权威快照里），
**两边都看得到**，但只有赢家能点 —— 服务端靠 `winnerIndex()` 校验。

## 加一个房间配置字段的固定清单

漏掉任何一步，TS 都不会报错（消息体是任意对象），但线上会读到 `undefined`。

1. `packages/shared/src/types/game.ts` → `GameOptions`
2. `packages/server/src/schema/GameRoomState.ts` → 加 `@type` 字段
3. `GameRoom.onCreate` → 读取并**钳制**（不信客户端）
4. `GameRoom.beginGame` → 传给 `startNewGame`
5. `GameRoom.pushFullState` → 加进快照消息体
6. `src/network/client.ts` → `FullStateSync` interface
7. `src/store/onlineStore.ts` → `RoomInfo` + `fullStateSync` handler
8. `src/pages/HomePage.tsx` → 建房 UI
9. `src/pages/LobbyPage.tsx` → **等待室也要显示**（否则客人不知道房主设了什么）

## 已经踩过的坑（别重复）

- **Colyseus 0.17 的客户端包是 `@colyseus/sdk`**，不是 `colyseus.js`（那个停在 0.16）。
  `onLeave(client, code: number)`，不是 `consented: boolean`；`CloseCode.CONSENTED = 4000`。
  0.17 **有** `onReconnect` 钩子（playbook 里说的 0.15 没有已过时）。
- **`allowReconnection` 冻结的连接仍占 `maxClients` 名额**，房间会保持 locked/full，
  导致「换设备靠昵称重认领」这条兜底路径根本进不来。
  → `onLeave` 里临时 `maxClients + 1` 并 `unlock()`，`refreshLock()` 收回。
- **刷新页面重连有竞态**：新页面可能比服务端处理完 WS 关闭更快，
  此时 `allowReconnection` 还没注册，`reconnect()` 拿到 `4003`/`522`。
  → 必须走带退避的重试循环，一次失败就清 token 会导致刷新永远回不去。
- **服务端不能用 `tsc` 直接输出**：产物里的 `@game/shared` 导入不会被重写，
  Node 会沿 workspace 符号链接解析到原始 `.ts` 而崩。
  → 用 `packages/server/build.mjs`（esbuild）把 shared 内联进单文件。
- **`Room` 基类已有私有的 `sendFullState`**，子类同名会报
  "Types have separate declarations of a private property"。本项目叫 `pushFullState`。
- **测试驱动节奏要慢于限流**（8 次/秒），否则合法动作被限流拒掉，表现为偶发失败。
  `tests/room.test.ts` 的 `step()` 会等状态真的变化，不要改回 `waitForNextMessage()`。
- **重连不要死磕**。曾经写成退避重试 12 次、离线时还不消耗次数，结果拉不回来时
  用户被永久困在「正在重连」转圈里 —— 比直接回首页更让人恼火。
  现在上限是 `RECONNECT_MAX_ATTEMPTS`（4 次），且提示条上有「不等了」出口。
  改这个值之前想清楚：**用户宁愿自己重开一局，也不愿干瞪着转圈。**
- **重连循环要带「代」（`reconnectGeneration`）**。用户点「不等了」或主动退出后，
  在跑的那个循环必须自己失效，否则它会在人已经回到首页后突然把人拽回牌桌。

## 部署

- 前端 → GitHub Pages。`vite.config.ts` 里 `base` 的**大小写必须和仓库名完全一致**。
- 后端 → Fly.io，`min_machines_running = 1` 避免冷启动。必须有 `GET /health`。
- CI 分开触发：前端改动才部前端，`packages/server/**` 或 `packages/shared/**` 才部后端。
- Secrets：前端 `VITE_SERVER_URL`（`wss://...`），后端 `FLY_API_TOKEN`。
- 后端环境变量 `ALLOWED_ORIGINS` 填前端域名（逗号分隔）做 CORS 白名单。
