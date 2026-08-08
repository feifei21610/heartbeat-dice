import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // ★ 重连测试共享服务端全局状态，并行会互相污染（playbook §7.3）
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5173',
    // ★ 网络受限环境里下载 chrome-headless-shell 会卡死，用已装的全量 chromium（playbook §7.5）
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  // 一条 npm run e2e 就自洽：同时拉起后端和 Vite
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://localhost:2567/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
