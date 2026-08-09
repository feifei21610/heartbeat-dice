# tangni & harriet's mini game 💗

两个人的联机小游戏。轮流摇骰子，**点数小的那个人**要老实回答一道真心话。

**在这里玩** → https://feifei21610.github.io/heartbeat-dice/

## 怎么玩

1. 一个人点「我来开一局」，选轮数和尺度（微甜 / 暧昧 / 心动），拿到一个 4 位房号
2. 把房号告诉另一个人，对方点「我有房号，加入她」输进去
3. 房主点开始，然后各摇各的
4. 每轮两颗骰子加起来，**小的人抽一题**，答完点「我说完了」进下一轮
5. 输的人每轮有 **1 次换题机会**；两人点数一样就重摇
6. 打满设定的轮数，赢的轮数多的人获胜

刷新页面、切后台、断网都能自动回到牌桌，不用重开。

## 本地跑起来

```bash
npm install
npm run dev:all      # 后端 2567 + 前端 5173
```

打开 http://localhost:5173 ，再开一个隐身窗口当另一个人。

## 测试

```bash
npm test    # 64 条：引擎单测 + 服务端房间集成测试
npm run e2e # 5 条：真浏览器双人对战 / 刷新重连 / 断网重连
npm run simulate 42 7 --verbose   # 命令行跑完一局
```

## 技术形状

```
packages/shared/     ★ 规则的唯一真相（纯函数引擎，前后端共用同一份源码）
  game-engine/       rng / rules / actions / round
  data/truths.ts     题库（三档）
packages/server/     Colyseus 权威服务端（房间状态机 + 断线重连）
src/                 Vite + React 前端（只做渲染与输入）
tests/ e2e/          Vitest + Playwright
```

- 服务端持有唯一 `GameState`，客户端只消费快照，**不做乐观更新**
- 随机全部走 seeded RNG，报 bug 只需给 seed 就能复现
- 详细约定见 `CLAUDE.md`

## 部署

- 前端：GitHub Pages（push 到 main 自动）
- 后端：Fly.io（`flyctl deploy --remote-only`，不需要本地 Docker）

需要配的 secrets：`VITE_SERVER_URL`（前端）、`FLY_API_TOKEN`（后端）。
