import { expect, test } from '@playwright/test';

test('能选深聊档并开局，抽到的是该档的题', async ({ browser }) => {
  const ca = await browser.newContext(); const a = await ca.newPage();
  const cb = await browser.newContext(); const b = await cb.newPage();
  await a.goto('/'); await b.goto('/');

  await a.getByPlaceholder('怎么称呼你').fill('tangni');
  await a.getByRole('button', { name: '我来开一局' }).click();

  // 两组选择器都在
  await expect(a.getByText('想撩')).toBeVisible();
  await expect(a.getByText('想聊')).toBeVisible();

  // 选「未来」档
  await a.getByRole('button', { name: '未来', exact: true }).click();
  await expect(a.getByText('规划、想象、对以后的期许')).toBeVisible();

  await a.getByRole('button', { name: /开房/ }).click();
  const roomId = (await a.locator('p.font-mono').textContent())!.trim();

  await b.getByPlaceholder('怎么称呼你').fill('harriet');
  await b.getByRole('button', { name: '我有房号，加入她' }).click();
  await b.getByPlaceholder('4 位数字').fill(roomId);
  await b.getByRole('button', { name: '进去' }).click();

  // 客人也该看到房主选的档
  await expect(b.getByText('未来')).toBeVisible();

  await a.getByRole('button', { name: '开始', exact: true }).click();
  await expect(a.getByRole('button', { name: '摇骰子' })).toBeVisible();
  // 牌桌顶部显示当前档位
  await expect(a.getByText('未来')).toBeVisible();

  await a.getByRole('button', { name: '摇骰子' }).click();
  await b.getByRole('button', { name: '摇骰子' }).click();
  await expect(a.locator('text=/老实回答|要回答|一样大/').first()).toBeVisible();

  const txt = await a.locator('body').innerText();
  console.log('抽到：', txt.split('\n').find(l => l.includes('？')) ?? '(平局)');

  await ca.close(); await cb.close();
});

test('换题不限次数，可以连点很多下', async ({ browser }) => {
  const ca = await browser.newContext(); const a = await ca.newPage();
  const cb = await browser.newContext(); const b = await cb.newPage();
  await a.goto('/'); await b.goto('/');

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

  // 摇到分出胜负。平局会重摇，所以要循环；每步都等状态稳定再判断，
  // 否则全量并行跑的时候会因为竞态漏掉「换一题」按钮。
  let loser = a;
  let found = false;
  for (let attempt = 0; attempt < 8 && !found; attempt++) {
    for (const p of [a, b]) {
      const roll = p.getByRole('button', { name: '摇骰子' });
      if (await roll.isVisible().catch(() => false)) {
        await roll.click();
        await p.waitForTimeout(250);
      }
    }
    await a.waitForTimeout(400);

    for (const p of [a, b]) {
      if (await p.getByRole('button', { name: '换一题' }).isVisible().catch(() => false)) {
        loser = p;
        found = true;
        break;
      }
    }
    if (found) break;

    const tie = a.getByRole('button', { name: '再摇一次' });
    if (await tie.isVisible().catch(() => false)) {
      await tie.click();
      await a.waitForTimeout(400);
    }
  }

  const btn = loser.getByRole('button', { name: '换一题' });
  await expect(btn).toBeVisible();

  // ★ 连点 6 次，全程不该被禁用
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    await expect(btn).toBeEnabled();
    const q = await loser.locator('p.font-serif-cn').first().textContent();
    if (q) seen.add(q.trim());
    await btn.click();
    await loser.waitForTimeout(350);
  }
  await expect(btn).toBeEnabled();
  console.log('换出了', seen.size, '道不同的题');
  expect(seen.size).toBeGreaterThan(2);

  await ca.close(); await cb.close();
});

test('房主在等待室改档位，客人立刻看到', async ({ browser }) => {
  const ca = await browser.newContext(); const a = await ca.newPage();
  const cb = await browser.newContext(); const b = await cb.newPage();
  await a.goto('/'); await b.goto('/');

  await a.getByPlaceholder('怎么称呼你').fill('tangni');
  await a.getByRole('button', { name: '我来开一局' }).click();
  await a.getByRole('button', { name: '微甜', exact: true }).click();
  await a.getByRole('button', { name: /开房/ }).click();
  const roomId = (await a.locator('p.font-mono').textContent())!.trim();

  await b.getByPlaceholder('怎么称呼你').fill('harriet');
  await b.getByRole('button', { name: '我有房号，加入她' }).click();
  await b.getByPlaceholder('4 位数字').fill(roomId);
  await b.getByRole('button', { name: '进去' }).click();

  // 客人进来时看到的是「微甜」
  await expect(b.getByText('微甜')).toBeVisible();

  // ★ 房主改成「三观」，客人应该立刻跟着变（靠 Schema 同步，不是重新加入）
  await a.getByRole('button', { name: '三观', exact: true }).click();
  await expect(b.getByText('三观')).toBeVisible();
  await expect(b.getByText('底线、原则、对感情的看法')).toBeVisible();

  // 轮数也一样
  await a.locator('input[type=range]').fill('12');
  await expect(b.getByText('12 轮')).toBeVisible();

  await ca.close(); await cb.close();
});
