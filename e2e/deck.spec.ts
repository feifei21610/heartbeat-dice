import { expect, test, type Page } from '@playwright/test';

/** 建房 → 客人加入 → 开局，返回两页 */
async function startedGame(browser: any) {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const a: Page = await ca.newPage();
  const b: Page = await cb.newPage();
  await a.goto('/');
  await b.goto('/');

  await a.getByPlaceholder('怎么称呼你').fill('tangni');
  await a.getByRole('button', { name: '我来开一局' }).click();
  await a.getByRole('button', { name: /开房/ }).click();
  const roomId = (await a.locator('p.font-mono').textContent())!.trim();

  await b.getByPlaceholder('怎么称呼你').fill('harriet');
  await b.getByRole('button', { name: '我有房号，加入她' }).click();
  await b.getByPlaceholder('4 位数字').fill(roomId);
  await b.getByRole('button', { name: '进去' }).click();

  await expect(a.getByText('harriet', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: '开始', exact: true }).click();
  await expect(a.getByRole('button', { name: '摇骰子' })).toBeVisible();
  await expect(b.getByRole('button', { name: '摇骰子' })).toBeVisible();

  return { ca, cb, a, b, roomId };
}

/** 两人轮流摇到分出胜负（平局自动重摇），返回 [赢家页, 输家页] */
async function rollUntilPicking(a: Page, b: Page): Promise<[Page, Page]> {
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const p of [a, b]) {
      const roll = p.getByRole('button', { name: '摇骰子' });
      if (await roll.isVisible().catch(() => false)) {
        await roll.click();
        await p.waitForTimeout(250);
      }
    }
    await a.waitForTimeout(450);

    // 赢家那边有「挑一道」提示，输家那边是「正在给你挑题」
    for (const [winner, loser] of [
      [a, b],
      [b, a],
    ] as [Page, Page][]) {
      if (await winner.getByText(/挑一道，让/).isVisible().catch(() => false)) {
        return [winner, loser];
      }
    }

    const tie = a.getByRole('button', { name: '再摇一次' });
    if (await tie.isVisible().catch(() => false)) {
      await tie.click();
      await a.waitForTimeout(450);
    }
  }
  throw new Error('never reached picking phase');
}

test('赢家挑题：四个候选，两边都看得到', async ({ browser }) => {
  const { ca, cb, a, b } = await startedGame(browser);
  const [winner, loser] = await rollUntilPicking(a, b);

  // ★ 两边都看得到候选题
  const winnerChoices = winner.locator('button', { hasText: '？' });
  await expect(winnerChoices).toHaveCount(4);
  const loserChoices = loser.locator('button', { hasText: '？' });
  await expect(loserChoices).toHaveCount(4);

  // 输家看到的是等待文案，且候选不可点
  await expect(loser.getByText(/正在给你挑题/)).toBeVisible();
  await expect(loserChoices.first()).toBeDisabled();

  // 赢家的候选可点
  await expect(winnerChoices.first()).toBeEnabled();

  await ca.close();
  await cb.close();
});

test('赢家挑定一道后，输家看到那道题并能答完', async ({ browser }) => {
  const { ca, cb, a, b } = await startedGame(browser);
  const [winner, loser] = await rollUntilPicking(a, b);

  const chosenText = (await winner
    .locator('button', { hasText: '？' })
    .nth(1)
    .textContent())!.trim();

  await winner.locator('button', { hasText: '？' }).nth(1).click();

  // 输家看到的正是赢家挑的那一道
  await expect(loser.getByText(chosenText)).toBeVisible();
  await expect(loser.getByRole('button', { name: '我说完了' })).toBeVisible();
  // 赢家没有「我说完了」按钮
  await expect(winner.getByRole('button', { name: '我说完了' })).toHaveCount(0);

  await loser.getByRole('button', { name: '我说完了' }).click();

  // 进入下一轮，两边都能重新摇
  await expect(loser.getByRole('button', { name: '摇骰子' })).toBeVisible();
  await expect(winner.getByRole('button', { name: '摇骰子' })).toBeVisible();

  await ca.close();
  await cb.close();
});

test('输家点候选没有反应（只有赢家能挑）', async ({ browser }) => {
  const { ca, cb, a, b } = await startedGame(browser);
  const [, loser] = await rollUntilPicking(a, b);

  // 候选是 disabled 的，点了不该进入 truth 阶段
  await loser.locator('button', { hasText: '？' }).first().click({ force: true });
  await loser.waitForTimeout(500);
  await expect(loser.getByRole('button', { name: '我说完了' })).toHaveCount(0);
  await expect(loser.getByText(/正在给你挑题/)).toBeVisible();

  await ca.close();
  await cb.close();
});

test('前端不显示题库分类', async ({ browser }) => {
  const { ca, cb, a, b } = await startedGame(browser);
  const [winner] = await rollUntilPicking(a, b);

  // 分类名不该出现在任何界面上
  for (const word of ['微甜', '暧昧', '心动', '记忆', '日常', '情绪', '过往', '三观', '未来']) {
    await expect(winner.getByText(word, { exact: true })).toHaveCount(0);
  }

  await ca.close();
  await cb.close();
});

test('建房时没有题库选择器', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByPlaceholder('怎么称呼你').fill('tangni');
  await page.getByRole('button', { name: '我来开一局' }).click();

  // 只剩轮数，没有「想撩/想聊」分组
  await expect(page.getByText('玩几轮')).toBeVisible();
  await expect(page.getByText('想撩')).toHaveCount(0);
  await expect(page.getByText('想聊')).toHaveCount(0);
  await expect(page.getByText('尺度')).toHaveCount(0);

  await ctx.close();
});
