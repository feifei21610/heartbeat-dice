import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * ★ 联机 bug 只在这一层现形（playbook §7.3）。
 *   必须有的两条：刷新回牌桌、断网回牌桌。
 */

async function openHome(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  return { context, page };
}

async function hostCreatesRoom(page: Page, nickname: string) {
  await page.getByPlaceholder('怎么称呼你').fill(nickname);
  await page.getByRole('button', { name: '我来开一局' }).click();
  await page.getByRole('button', { name: /开房/ }).click();
  // 大厅显示 4 位房号
  const code = page.locator('p.font-mono');
  await expect(code).toBeVisible();
  const roomId = (await code.textContent())!.trim();
  expect(roomId).toMatch(/^\d{4}$/);
  return roomId;
}

async function guestJoins(page: Page, nickname: string, roomId: string) {
  await page.getByPlaceholder('怎么称呼你').fill(nickname);
  await page.getByRole('button', { name: '我有房号，加入她' }).click();
  await page.getByPlaceholder('4 位数字').fill(roomId);
  await page.getByRole('button', { name: '进去' }).click();
}

/** 两人进房并开局，返回两个 page */
async function startedGame(browser: Browser) {
  const a = await openHome(browser);
  const b = await openHome(browser);
  const roomId = await hostCreatesRoom(a.page, 'tangni');
  await guestJoins(b.page, 'harriet', roomId);

  // 房主看到对方坐进座位（用 exact 避开「harriet 来了」那条 toast）
  await expect(a.page.getByText('harriet', { exact: true })).toBeVisible();
  await a.page.getByRole('button', { name: '开始', exact: true }).click();

  // 两边都进牌桌
  await expect(a.page.getByRole('button', { name: '摇骰子' })).toBeVisible();
  await expect(b.page.getByRole('button', { name: '摇骰子' })).toBeVisible();
  return { a, b, roomId };
}

test('两个人能从建房打到出真心话', async ({ browser }) => {
  const { a, b } = await startedGame(browser);

  await a.page.getByRole('button', { name: '摇骰子' }).click();
  await expect(a.page.getByRole('button', { name: '已经摇了' })).toBeVisible();

  await b.page.getByRole('button', { name: '摇骰子' }).click();

  // 判出胜负后：赢家开始挑题，或平局要重摇
  const pickingOrTie = a.page.locator('text=/挑一道，让|正在给你挑题|一样大/');
  await expect(pickingOrTie.first()).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('非自己回合时按钮 disabled，不做乐观更新', async ({ browser }) => {
  const { a, b } = await startedGame(browser);

  await a.page.getByRole('button', { name: '摇骰子' }).click();
  // 摇过之后按钮必须禁用，防止重复派发
  await expect(a.page.getByRole('button', { name: '已经摇了' })).toBeDisabled();

  await a.context.close();
  await b.context.close();
});

test('游戏中刷新页面 → 自动重连回到牌桌', async ({ browser }) => {
  const { a, b } = await startedGame(browser);

  await a.page.getByRole('button', { name: '摇骰子' }).click();
  await expect(a.page.getByRole('button', { name: '已经摇了' })).toBeVisible();

  // ★ 刷新：靠 localStorage 里的 token 自动回来（playbook §5.2 第 1 点）
  await a.page.reload();

  // 回到牌桌，而不是掉回首页
  await expect(a.page.getByText(/第 .* 轮/)).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByPlaceholder('怎么称呼你')).toHaveCount(0);
  // 而且掷过的状态还在（服务端权威快照补发）
  await expect(a.page.getByRole('button', { name: '已经摇了' })).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('游戏中断网 → 出现重连提示 → 恢复网络 → 自动回到牌桌', async ({ browser }) => {
  const { a, b } = await startedGame(browser);

  // ★ setOffline 不会立刻关 WS，被测代码必须响应 browser offline 事件
  //   （playbook §5.2 第 2 点 / §7.3）
  await a.context.setOffline(true);

  // 重连提示条出现，且牌桌没被跳走
  await expect(a.page.getByText(/正在重连/)).toBeVisible({ timeout: 20_000 });
  await expect(a.page.getByText(/第 .* 轮/)).toBeVisible();

  await a.context.setOffline(false);

  // 自动回到可操作状态
  await expect(a.page.getByText(/正在重连/)).toHaveCount(0, { timeout: 40_000 });
  await expect(a.page.getByRole('button', { name: '摇骰子' })).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('房号错误有明确提示', async ({ browser }) => {
  const { context, page } = await openHome(browser);
  await guestJoins(page, 'tangni', '0000');
  await expect(page.getByText(/没找到这个房间/)).toBeVisible();
  await context.close();
});

test('断网拉不回来时，能点「不等了」自己回首页重开', async ({ browser }) => {
  const { a, b } = await startedGame(browser);

  await a.context.setOffline(true);
  await expect(a.page.getByText(/正在重连/)).toBeVisible({ timeout: 20_000 });

  // ★ 不该被困在重连界面：点「不等了」立刻回首页
  await a.page.getByRole('button', { name: '不等了' }).click();
  await expect(a.page.getByPlaceholder('怎么称呼你')).toBeVisible();
  await expect(a.page.getByText(/正在重连/)).toHaveCount(0);

  // 恢复网络后也不该被自动拽回牌桌（用户已经明确表示不等了）
  await a.context.setOffline(false);
  await a.page.waitForTimeout(3000);
  await expect(a.page.getByPlaceholder('怎么称呼你')).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('重连尝试次数有上限，不会无限转圈', async ({ browser }) => {
  const { a, b } = await startedGame(browser);

  // 一直断网 → 试几次之后应该自己放手回首页，而不是永远转
  await a.context.setOffline(true);
  await expect(a.page.getByText(/正在重连/)).toBeVisible({ timeout: 20_000 });

  await expect(a.page.getByPlaceholder('怎么称呼你')).toBeVisible({ timeout: 45_000 });
  await expect(a.page.getByText(/没连上/)).toBeVisible();

  await a.context.close();
  await b.context.close();
});
