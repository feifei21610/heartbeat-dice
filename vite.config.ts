import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('./packages/shared/src', import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// ★ base 的大小写必须和 GitHub 仓库名完全一致，写错了线上全 404（playbook §8 坑 1）
const REPO_NAME = 'heartbeat-dice';

export default defineConfig({
  base: isProd ? `/${REPO_NAME}/` : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@game/shared/types': `${shared}/types/game.ts`,
      '@game/shared/constants': `${shared}/constants/game.ts`,
      '@game/shared/game-engine': `${shared}/game-engine/index.ts`,
      '@game/shared/data': `${shared}/data/truths.ts`,
      '@game/shared': `${shared}/index.ts`,
    },
  },
  server: { port: 5173 },
});
