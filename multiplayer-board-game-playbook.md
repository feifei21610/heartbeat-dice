# 多人对战桌游 Web 实现 Playbook

> 这份文档是从一个已上线项目（Twinum，致敬《SCOUT!》的 4 人卡牌对战，Vite + React + Colyseus，前端 GitHub Pages + 后端 Fly.io）里提炼的**跨项目通用经验**，刻意剥掉了原项目的具体规则。
>
> **给 AI 助手看的**：如果你正在接手一个「新的多人对战桌游」项目，请把本文当作既有约束和默认技术选型来读。文中的「必须 / 不要」都是踩过坑之后的结论，不是风格偏好。偏离之前先问用户。
>
> 适用范围：回合制、状态离散、有隐藏信息（手牌）、3–8 人、朋友局规模（不需要账号系统 / 匹配队列 / 排行榜）的桌游。实时动作游戏（需要插值、预测回滚）不适用。

---

## 0. 一句话结论

**先把规则写成文档，再把规则写成纯函数引擎，再套 UI，最后接联机。**
四个阶段的顺序不能换。每换一次,都要付一次重写的代价。

联机不是「后期加的功能」,而是「第一天就要预留的形状」。预留的成本只有三条(见 §2),补的成本是重写状态层。

---

## 1. 推荐技术栈与仓库形状

### 1.1 选型

| 层 | 选择 | 理由 / 备注 |
|---|---|---|
| 前端 | Vite + React + TypeScript | 无 SSR 需求,构建快,能直接扔静态托管 |
| 样式 | Tailwind CSS | 桌游 UI 大量一次性布局,不值得开组件库 |
| 动画 | framer-motion | 发牌/翻牌/出牌需要 `AnimatePresence`,手写 CSS 会失控 |
| 状态 | Zustand | 单机模式要 persist,联机模式要频繁整体替换快照,Redux 太重、Context 会全树重渲染 |
| 联机 | **Colyseus** | 房间制 + Schema 自动 diff 同步 + 内置重连窗口。自己撸 ws 会在「重连」和「私有状态」上耗掉两周 |
| 单测 | Vitest | 引擎是纯函数,单测跑在 node 环境,毫秒级 |
| E2E | Playwright | 联机 bug 只有真浏览器能复现(见 §7.3) |
| 部署 | 前端静态托管 + 后端小容器 | 见 §8 |

### 1.2 目录形状(npm workspaces monorepo)

关键点:**引擎代码必须被前端和服务端同一份源码引用**,不能是两份副本。

```
package.json                 # "workspaces": ["packages/*"]
tsconfig.app.json            # paths: "@game/shared" -> packages/shared/src/index.ts
                             # include 里必须带上 packages/shared/src
packages/
  shared/                    # ★ 唯一的规则真相
    package.json             # exports 分子路径: ./types ./game-engine ./bot ...
    src/
      types/game.ts          # GameState / Action / Player / Card
      constants/game.ts
      game-engine/
        rng.ts               # seeded random（★ 见 2.4）
        deck.ts              # 建牌堆 / 洗牌 / 发牌
        rules.ts             # 纯判定：canShow / isLegal / 组合识别
        actions.ts           # applyAction(state, action) => newState
        scoring.ts
        round.ts             # startNewGame / advanceRound
        index.ts
      bot/
        decide.ts            # (state, playerIndex) => Action
        index.ts
  server/
    package.json             # colyseus + express
    src/
      index.ts               # express + ws transport + /health
      rooms/GameRoom.ts      # ★ 权威状态机
      schema/GameRoomState.ts
    Dockerfile
src/                         # 前端；只做渲染与输入
  network/client.ts          # Colyseus 封装成事件发射器
  store/gameStore.ts         # 单机（本地权威）
  store/onlineStore.ts       # 联机（消费服务端快照）
  pages/ components/
tests/                       # 引擎单测
e2e/                         # Playwright
```

**血泪教训**:原项目在 `src/game-engine/` 和 `packages/shared/src/game-engine/` 各留了一份引擎,前端一直 import 本地那份。结果两份逐渐分化——`round.ts` 的 `totalRounds` 在 shared 里支持自定义、在本地还是硬编码;`rules.ts` 在本地多了个 UI 诊断函数。**新项目请在建目录的第一天就只留 shared 一份**,前端 `import { applyAction } from '@game/shared/game-engine'`。别想着「先在 src 里写快,以后再挪」——不会挪的。

---

## 2. 四条不可协商的架构约束

这四条是「联机兼容」的全部成本。做到了,从单机到联机只需要加一层网络,不动引擎、不动 UI 结构。

### 2.1 引擎与 UI 彻底解耦

所有规则、状态转移、计分放在 `packages/shared/game-engine/`,**全部是纯函数**,签名统一为:

```ts
applyAction(state: GameState, action: Action): GameState
```

约束:
- 引擎不 import 任何 React / DOM / store。
- **UI 组件里一行游戏逻辑都不写**。「这张牌能不能出」是 `rules.ts` 的事,不是 `<Card>` 的事。
- 非法动作时 `applyAction` **返回原对象**(`===` 恒等),而不是抛异常。服务端就靠 `next === current` 判非法(见 §4.2),这个约定很好用,但要写在引擎注释里。

收益是复利的:单测不用 mount、扩玩家数不改 UI、服务端直接复用同一份引擎做权威校验。

### 2.2 所有状态变化走 Action 派发

唯一入口 `dispatchAction(action)`。UI 不允许直接改 state。

Action 必须是**可 JSON 序列化的纯数据**(`{ type: 'Show', cardIds: [...] }`),因为它就是未来 WebSocket 上传的报文。任何时候你想在 Action 里塞一个函数、一个 class 实例、一个 DOM ref,就是在给联机埋雷。

### 2.3 Player 抽象化,Bot 与远程玩家同形

```ts
type Player = { id: string; nickname: string; type: 'human' | 'bot' | 'remote'; ... }
type GameState = { players: Player[]; currentPlayerIndex: number; ... }
```

- **不要**写 `{ human: Player, bots: Player[] }`,不要 tuple。用数组 + 索引。
- Bot 决策函数签名 `(state, playerIndex) => Action`,和「收到远程玩家的 Action」形状相同。于是「Bot 接管掉线玩家」这个功能几乎免费(见 §5.3)。
- 玩家数从 4 扩到 5 应该只改一个常量。如果要改 UI 布局代码,说明 2.1 没做到。

### 2.4 随机性可复现:seeded RNG

洗牌、发牌、Bot 的随机犯错,**全部**经过一个可注入的 seeded RNG,seed 存进 `GameState`。

```ts
// rng.ts —— 不要在任何地方直接调 Math.random()
export function createRng(seed: number) { /* mulberry32 / xorshift */ }
```

收益:
- 用户报 bug 只需要给 seed 就能复现。
- 单测不用打桩随机数。
- 服务端可以对客户端行为做权威校验。
- 可以写命令行对局模拟脚本(见 §7.4)。

**注意**:每一轮重新发牌时要重新 seed(或者保存 rng 游标),否则重连补发状态时随机序列会错位。

---

## 3. 服务端权威模型

### 3.1 心法:服务端持有 GameState,客户端只持有快照

```
客户端                          服务端
点击
 └─ sendAction() ──ws──→  校验(是你的回合? 动作合法? 限流?)
                                applyAction()  ← 同一份 shared 引擎
                          ┌──── 广播 fullStateSync / actionApplied
 收到快照 → set store ────┘
 → 重渲染
```

**不要做乐观更新。** 桌游是回合制,一次往返 50–200ms 完全可接受;而乐观更新会引入「本地状态与权威状态分叉」这一整类极难调的 bug。防止点击手感发虚的正确做法是:**UI 按钮在非自己回合时 `disabled`**,而不是本地先改状态。

### 3.2 两套同步渠道:Schema vs 消息

Colyseus 有两种下发数据的方式,**混淆这两者是新手最常见的 bug 源**。

| 渠道 | 用途 | 写法 |
|---|---|---|
| Schema 自动同步(`@type` 字段) | 房间的**持续性公共状态**,自动 diff、自动补发给新连接 | `this.state.targetRounds = 4` |
| 显式 `send` / `broadcast` 消息 | **事件性**数据:某人出了牌、本轮结算、全量补发 | `this.broadcast('actionApplied', {...})` |

判断规则:
- **持续性配置 / 公共状态** → Schema。因为重连的客户端会自动拿到,不需要你手动补。
- **一次性事件**(动作播报、轮次结算、错误提示) → 消息。
- **同时需要「重连后能拿到」和「大厅 UI 立刻更新」的字段 → 两边都要写**。原项目在这里踩过:Schema 里加了 `targetRounds`、大厅快照消息里忘了加,结果大厅显示 `undefined`;反过来漏 Schema 则重连后读到默认值。

### 3.3 隐藏信息(手牌)的处理

**只在 Schema 里放 `handSize: number`,永远不要把牌面放进公共 Schema。** 然后用一条定向消息 `client.send('privateHand', { hand })` 发给本人。

理由:Colyseus 的 `@filter` 装饰器可以做字段级过滤,但它的心智负担和出错代价高(过滤逻辑写错 = 直接泄漏对手手牌,而且 UI 上看不出来)。「公共只有数量 + 私有走单独消息」这个划分粗糙但不会错。

前端渲染对手手牌时用占位卡:

```ts
const placeholders = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, faceDown: true }));
```

### 3.4 GameRoom 的骨架

```ts
export class GameRoom extends Room<GameRoomState> {
  onCreate(options) {
    this.autoDispose = true;
    // 房间配置：一律钳制到合法范围，不信客户端
    const count = Math.max(3, Math.min(5, options.targetPlayerCount ?? 4));
    this.maxClients = count;
    this.setState(new GameRoomState());
    this.state.targetPlayerCount = count;

    this.onMessage('action',    (c, m) => this.handlePlayerAction(c, m));
    this.onMessage('startGame', (c)    => this.handleStartGame(c));   // 校验房主
    this.onMessage('nextRound', (c)    => this.handleNextRound(c));   // 校验房主
  }

  onJoin(client, options) { /* 昵称清洗、座位分配或重认领 */ }

  async onLeave(client, consented) { /* 见 §5 */ }
}
```

要点:
- `autoDispose = true`,空房间自动回收,免得白付内存。
- `filterBy(['targetPlayerCount'])` 让不同人数的房间不互相撮合。
- **所有来自客户端的数值都要钳制**,所有「只有房主能做」的操作都要在 handler 里查 `hostSessionId`。客户端的 disabled 只是 UX,不是权限。

---

## 4. 服务端校验的三道闸

`handlePlayerAction` 里按顺序全部检查,任何一道不过就 `client.send('error', { message })` 并 return。

```ts
// 1) 回合归属
if (session.playerIndex !== this.state.currentPlayerIndex) {
  return client.send('error', { message: '不是你的回合' });
}

// 2) 动作合法性：重跑引擎，靠恒等判断（见 2.1）
const next = applyAction(current, action);
if (next === current) {
  return client.send('error', { message: '这个动作不合法' });
}

// 3) 限流：每 session 每秒 N 条
if (this.isRateLimited(client.sessionId)) {
  return client.send('error', { message: '操作太频繁' });
}
```

**错误消息必须在前端有出口。** 原项目的 `onlineStore` 收到 `error` 只 `console.error` 加存进 state,页面没消费——用户点了没反应、控制台才有原因。**联机项目的第一个 UI 组件应该是一条错误提示条**,比任何游戏画面都优先。

---

## 5. 断线重连(联机项目一半的工作量)

这是最容易低估的部分。请按下面的分层来做,顺序是按「多数人只做到第 1 层然后线上炸掉」排的。

### 5.1 服务端:只有一套正确写法

```ts
async onLeave(client: Client, consented: boolean) {
  if (consented) { this.removePlayer(client.sessionId); return; }   // 主动退出
  if (this.state.roomPhase === 'lobby') { this.removePlayer(...); return; }

  this.markDisconnected(client.sessionId);        // 标记 + 广播给其他人
  try {
    const back = await this.allowReconnection(client, 60);
    // 重连成功：sessionId 不变，座位原地复活
    this.markReconnected(back.sessionId);
    back.send('fullStateSync', this.buildClientState(back.sessionId));
    // ★ 还要按当前 phase 补发 roundEnd / gameOver，否则重连回来卡在结算界面前
  } catch {
    this.takeoverWithBot(playerIndex);            // 60s 超时：Bot 接管
  }
}
```

**坑:Colyseus 0.15 没有 `onReconnect` 生命周期钩子**(0.16 才有)。原项目写了一个 `async onReconnect()` 然后**一次都没被调用过**,所有重连都掉进「新玩家加入」分支,导致同名玩家 + Bot 并存的诡异现象,排查了很久。请先确认你装的 Colyseus 版本有哪些钩子,别照抄博客。

`allowReconnection(client, seconds)` 的语义是:把这个连接冻结住,期间 `sessionId` 保持有效。所以 `this.state.players` 里那条记录**不用搬**,续上就活。

### 5.2 客户端:四层兜底

1. **重连 token 必须存 `localStorage`,不是 `sessionStorage`。**
   一个字之差,差一整套功能。`sessionStorage` 在关标签页 / 新标签页打开分享链接 / 手机切后台被回收时全部丢失——也就是「除了页内刷新以外的所有真实场景」。
   配套:`leave()` 和「重连最终失败」分支里**必须清掉** localStorage,否则下次启动拿着过期 token 撞墙。

2. **实时断线检测。** 这是原项目真正的病根:客户端根本不知道自己断了,界面一直显示正常,用户以为卡死。
   - `room.onLeave(code)`:`code !== 1000` 视为异常断线 → 发 `connectionLost` 事件。要用一个 `intentionalLeave` 标志把主动退出排除掉。
   - **同时**监听浏览器的 `online` / `offline` 事件。因为 `setOffline` / 拔网线**不会立刻关闭 WebSocket**(要等 TCP 超时几十秒),只靠 WS 回调会有几十秒的假死窗口。

3. **自动重连循环:指数退避 + 网络状态感知。**
   ```ts
   let attempt = 0;
   while (attempt < 12) {
     if (!navigator.onLine) { await sleep(1000); continue; }  // 网络没恢复不消耗次数
     try { await networkClient.reconnect(); return; }
     catch { attempt++; await sleep(Math.min(500 * 2 ** attempt, 8000)); }
   }
   ```
   重连期间**保留牌桌画面 + 叠一条「重连中…」提示条**,不要跳走或白屏。跳走等于告诉用户「你输了」。

4. **昵称即身份的备用路径。** token 绑浏览器,换设备 / 清缓存就废。让 `onJoin` 支持「同房间内昵称匹配到一个 disconnected 座位 → 重认领」。这是廉价且对朋友局非常有效的兜底。真正的账号系统是另一个量级,朋友局定位下不划算。

### 5.3 Bot 接管

因为 §2.3 做了 Player 抽象,接管只是 `player.type = 'bot'`。然后:

```ts
private maybeRunBot() {
  if (this.botRunning) return;                    // ★ 防重入
  const p = this.currentPlayer();
  if (p.type !== 'bot') return;
  this.botRunning = true;
  setTimeout(() => {
    let action = createBot(p.botConfigKey).act(state, idx);
    let next = applyAction(state, action);
    if (next === state) {                         // ★ Bot 出了非法动作
      action = this.buildBotFallbackAction(state, idx);  // 服务端兜底一个必然合法的动作
      next = applyAction(state, action);
    }
    // ... 落地、广播、如果下一个还是 bot 则自链
  }, 1200);   // ★ 加思考延迟，瞬间出牌看不清发生了什么
}
```

三个必须:**防重入标志**(否则 setTimeout 会叠)、**非法动作兜底**(Bot 有 bug 时整局会卡死,不能信任 Bot 的输出)、**思考延迟 ~1s**(纯 UX,但少了这个游戏就没法看)。

### 5.4 联机状态机的 phase 谁来设

**`phase: 'playing'` 必须由服务端下发的数据驱动,而不是由「操作成功」驱动。**

原项目的 bug:`reconnect()` 一 `await` 成功就 `set({ phase: 'playing' })`,但此时 `gameSnapshot` 还是 null,`GamePage` 拿不到数据 → 空白/报错,几百毫秒后快照才到。

正确做法:`reconnect()` 只负责恢复 roomId / nickname / sessionId,phase 留在 `'connecting'`;由 `fullStateSync` 的 handler 根据 payload 里的 `gameState.phase` 来设置。**状态切换由权威数据驱动,不由操作结果驱动**——这条在联机项目里会反复用到。

### 5.5 事件监听的重复注册

`attachNetworkListeners` 要有模块级守卫:

```ts
let listenersAttached = false;
function attachNetworkListeners(set, get) {
  if (listenersAttached) return;
  listenersAttached = true;
  /* ... */
}
```

否则每次重连都叠一层 handler,表现为「一个动作被处理了 3 次」,而且随重连次数增长。

---

## 6. 单机模式与联机模式的共存

**建议做单机模式(人 vs Bot),而且先做它。** 理由:它是引擎的活体验证、是没网时的 fallback、也是新手教程的天然载体。

两个 store,职责不同:

| | `gameStore`(单机) | `onlineStore`(联机) |
|---|---|---|
| 持有 | 完整 `GameState`(本地权威) | `snapshot` + `myHand`(消费者) |
| 派发 | `applyAction` 同步改本地 | `send` 到服务端,不动本地 |
| 持久化 | localStorage(带 version!) | 只存 reconnect token / roomId |

页面层用**最小分叉**合并:

```tsx
const isOnline = onlinePhase === 'playing' || onlinePhase === 'roundEnd' || onlinePhase === 'gameOver';
// 只在「数据源」和「派发函数」两处分叉；ActionBar / HandArea / 牌面组件全部共用
```

这个模式在原项目里成立得不错(GamePage 同时支持两种模式,没有复制一份 OnlineGamePage)。但要盯住一件事:**多步交互**(比如「先选一张牌、再选插入位置」这种两阶段动作)在两种模式下的索引偏移计算必须完全一致,否则会出现只在联机下错位的 bug。这类逻辑应该抽成 shared 里的纯函数,而不是在页面里写两遍。

---

## 7. 测试基建(三层 + 一个模拟器)

### 7.1 Layer 1 — 引擎单测(vitest,`environment: 'node'`)

覆盖 `rules / actions / scoring / deck / bot`。不 mount React,几十到上百条用例秒级跑完。这是改规则时唯一的安全网,值得写厚。

**Bot 要写「锁定测试」**:「这个局面下必须选这个动作」。Bot 的评分函数一调就会悄悄退化,只有锁定测试能拦住。

### 7.2 Layer 2 — 服务端房间集成测试

用 `@colyseus/testing`(**版本要和 colyseus 主包对齐**)。测房间状态机:座位分配、断线重连、Bot 接管、大厅→游戏的相变。

这一层能验证「服务端逻辑在理想网络下是对的」,但**测不出客户端问题**。

### 7.3 Layer 3 — E2E(Playwright)

**联机 bug 只在这一层现形。** 原项目最贵的一课:怀疑重连失败是「客户端 colyseus.js 0.16 / 服务端 colyseus 0.15 版本不一致」,查了很久;E2E 一跑发现混用版本下端到端是通的,真正的病根是客户端没有实时断线检测(§5.2 第 2 点)。**没有 E2E,你会花几天时间修一个不存在的 bug。**

配置要点:
- `webServer` 同时拉起后端和 Vite dev,让 `npm run e2e` 一条命令自洽。
- `fullyParallel: false`, `workers: 1` —— 重连测试共享服务端全局状态,并行会互相污染。
- 断线复现:`context.setOffline(true)` + `page.reload()`。**注意 `setOffline` 不会立刻关 WS**,所以被测代码必须响应 browser `offline` 事件(这正好也是 §5.2 要求的)。
- 多人场景:开两个 `browser.newContext()` 各自一个 page,一个当房主一个当客人。

**至少要有这两条 E2E**:
1. 游戏中刷新页面 → 自动重连回到牌桌。
2. 游戏中断网 → 出现重连提示 → 恢复网络 → 自动回到牌桌。

### 7.4 加一个命令行对局模拟器

```bash
npx tsx scripts/simulate-game.ts <seed> [--verbose]
```

全 Bot 跑完整一局,打人类可读的日志。用途:调 Bot 平衡、跑几百个 seed 找引擎崩溃、复现用户报的局面。因为有 §2.4 的 seeded RNG,这个脚本几十行就能写出来,性价比极高。

### 7.5 环境坑(可能已过时,遇到再说)

- Node 24 下 vitest 默认的 `forks` pool 的 worker IPC 会崩(`ERR_INVALID_ARG_TYPE` / `Buffer.from`)→ 全项目改 `pool: 'threads'`。
- 网络受限环境里 Playwright 下载 `chrome-headless-shell` 会卡死 → `channel: 'chromium'` 用已安装的全量构建绕开。

---

## 8. 部署形状:静态前端 + 小容器后端

因为 WebSocket 需要长连接,前端的静态托管方案(GitHub Pages / CF Pages)托不了后端,必须分开。

```
前端 → GitHub Pages / Cloudflare Pages（免费，CI 里 npm ci → test → build → deploy）
后端 → Fly.io / Railway 之类的小容器
        shared-cpu 256MB 够用；min_machines_running=0 省钱但有 2–5s 冷启动
        必须有 GET /health
        环境变量：PORT / NODE_ENV / ALLOWED_ORIGINS（CORS 白名单填前端域名）
```

前后端衔接:

```
.env.development         VITE_SERVER_URL=ws://localhost:2567
CI secret                VITE_SERVER_URL=wss://your-app.fly.dev
```

三个坑:

1. **子路径部署的 base**:`vite.config.ts` 里 `base: isProd ? '/RepoName/' : '/'`,**大小写必须和仓库名完全一致**。写错了线上所有资源 404,而本地一切正常。
2. **冷启动**:后端 scale-to-zero 时首次连接要 2–5 秒。客户端连接超时要设 8s 左右,并且**超时后自动重试一次**——第一次请求负责唤醒机器,第二次就通了。
3. **CI 分开触发**:前端改动才重新部前端,`packages/server/**` 或 `packages/shared/**` 改动才重新部后端。否则改个 CSS 也要重启服务端,把在线的人踢下线。

---

## 9. Bot 设计(如果需要 Bot)

朋友局桌游几乎一定需要 Bot:凑不齐人、掉线接管、单机模式。两条经验。

### 9.1 不要做「加分项大杂烧」

第一版 Bot 常见做法:基础分 + 手牌减少分 + 长度分 + 某某系数 × 0.3 + 终局冲刺分…… 全丢进一个池子相加。结果是 Bot 行为像喝醉了,而且**没法调**——动一个系数,三个不相关的场景一起变。

改成**分级规划驱动**:

```
L0 强制行动（规则逼你必须做某事）
L1 建立某个战略目标（比如凑出防御性组合）
L2 处理结构性缺陷（消掉孤立牌）
L3 正常最优行动
L4 兜底（必然合法的动作）
```

每一级有**独立的分数段**(比如 L3 用 500–800,L4 用 100–300),段与段之间隔开。上一级有可行动作时,下一级完全不参与评分。这样调 Bot 变成「改某一级的规则」,不会牵连其他场景。

### 9.2 复合动作绝不能贪心

如果游戏里有「A 之后接 B」的复合动作(先拿一张牌、再出牌),**不能**先算「A 单独看最优的参数」再判断能不能接 B。因为让 A 单独最优的参数,往往不是让 A+B 整体最优的参数(比如 A 有个「翻转」选项,单看没用,但翻转之后数字变了才能凑成 B)。

必须**完整枚举 (A 参数 × B 参数) 的组合空间**取全局最优。原项目在这里踩了坑,现在有专门的锁定测试守着。

### 9.3 随机犯错要有致命局面白名单

给 Bot 加 `mistakeRate` 让它显得像人是好主意,但**在「规则强制、做错就直接输 / 让对手白拿分」的局面必须关掉随机**。原项目的做法是 L0 层禁用 `mistakeRate`,其他层允许。

---

## 10. 新手引导 / 规则页(不要留到最后)

原项目最大的产品级失误:规则页写成了「规则书的忠实转录」,新手打开一脸懵,改了两版还是乱。

规则页应该按**新手的认知顺序**来组织,不是按规则书的章节顺序:

1. **一句话概览胶囊**:几人玩 / 每人几张牌 / 打几轮 / 怎么算赢。放最上面,默认展开。
2. **一个从头到尾走完的完整例子**(带图,3–5 个人的行动序列)。**这个要放在细则之前**,而且默认展开——新手需要先有直觉,再回头抠条文。原项目反了:300 行细则糊在脸上,例子藏在折叠里。
3. **术语小词典**。桌游最容易在这里翻车:「轮」和「回合」混用、同一个区域叫「桌面 / 场上 / 场中央 / 你面前」四个名字。**先定一套词,然后全项目(UI 文案、代码命名、文档)只用这套词。**
4. **同一机制的说明必须聚在一起**。原项目把「翻面」拆成三处各半句话,谁也看不懂。
5. **每条规则后面跟一句「为什么」**。玩家记不住规则,但记得住动机。

其他 UI 教训:

- **数值旁边一定要有文字标签。** 纯图标 `🃏 11 🎖 3` 新手完全不知道是什么。要写「手牌 11 / 得分 3」。图标是装饰,文字才是信息。
- **加分/扣分用颜色区分**(绿/红),不要同色胶囊只靠 +/− 号。
- **辅助信息面板(日志、历史)做侧栏,不要做 Modal。** 原项目的日志抽屉一开始盖住牌桌、带遮罩,操作被阻塞。改成右侧 260px 无遮罩窄抽屉、只留最近两轮,体验立刻正常。
- **例子里的数字务必自查一遍。** 原项目的规则页例子自相矛盾(前面说单张、后面画两张),而且算到一半没给最终总分。新手会以为是自己理解错了。
- **UI 联动要「只覆盖默认值,尊重用户显式选择」。** 原项目的「轮数默认 = 人数」做成了「每次改人数都强制重置轮数」,用户先设了 5 轮再改人数,轮数被弹回去,以为是 bug。正确写法:
  ```ts
  if (rounds === prevPlayerCount) setRounds(newPlayerCount);  // 只在还是旧默认值时联动
  ```

---

## 11. 其他零碎但会咬人的坑

- **持久化数据第一天就带 version。** `GameState` 加字段后,老用户刷新直接白屏。做法:store key 带版本号 + `onRehydrateStorage` 里 catch 住反序列化错误、回落到初始状态。别等挨过一次再加。
- **写了 `localStorage.setItem` 就必须有对应的 `getItem`。** 原项目留了一堆 set 了没人读的 key,后来排查重连问题时看到这些 key,以为持久化已经做好了,白找了很久。同一个 PR 里没有读取方,就直接删掉。
- **framer-motion 的 `height: 0 → 'auto'`** 需要外层 `overflow: hidden` 才有动画。这个 pattern 第一次调通就抽成公共组件,别复制第三遍。
- **Schema 加一个字段,检查清单是固定的**:引擎的 options 类型 → 服务端 Schema → `onCreate` 读取并钳制 → 传给引擎 → 快照消息体 → 客户端网络层的 interface → store 的 state/action/初始值/监听 → 创建房间的 UI → **等待室也要显示**(否则客人不知道房主设了什么)。漏掉客户端 interface 时 TS 不会报错(因为消息体是任意对象),但线上出错极难定位。**把这个清单写进项目 CLAUDE.md。**
- **git identity 隔离**:公开仓库别用工作邮箱。进新 clone 先 `git config user.email` 确认。

---

## 12. 推荐排期(单人 + AI 助手,约两周)

| 阶段 | 产出 | 门禁 |
|---|---|---|
| D0–1 | 规则文档、视觉风格、术语词典、MVP 范围;仓库 + CI + 部署跑通 Hello World | **规则文档里没有歧义**才能进下一步 |
| D2–5 | `packages/shared/game-engine/` + 引擎单测。**不写任何 UI** | 单测覆盖所有规则边界 |
| D6–7 | 命令行模拟器 + Bot(先随机合法动作,再逐级加策略) | 跑 100 个 seed 不崩 |
| D8–11 | 单机模式 UI(store 唯一入口 dispatchAction) | 自己能完整打完一局 |
| D12–14 | 服务端 GameRoom + 客户端网络层 + 大厅 + **断线重连 + E2E** | 两个浏览器打完一局;刷新和断网都能回来 |
| 之后 | 邀 3–5 人真人测试,逐条改,改完即发布 | —— |

注意 D12–14 那一格看起来只占 3 天,实际上**断线重连会吃掉其中一半以上时间**。别把它当收尾工作排。

---

## 13. 给接手的 AI 助手的操作提示

- 动手前先确认:Colyseus 的版本、以及该版本有哪些生命周期钩子。不要照抄本文或博客里的钩子名。
- 每次改「房间配置类字段」,走 §11 的固定清单,一处不漏。
- 遇到「联机下重连/同步不对」的问题,**先写一条 E2E 复现,再猜原因**。这类 bug 的直觉命中率极低(见 §7.3)。
- 报告结果要如实:测试没过就贴输出。联机项目里「看起来能跑」和「真的能跑」差距很大。
- 破坏性操作(删文件、覆盖、推远端)执行前跟用户确认。
