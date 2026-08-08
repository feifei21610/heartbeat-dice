import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('./packages/shared/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@game/shared/types': `${shared}/types/game.ts`,
      '@game/shared/constants': `${shared}/constants/game.ts`,
      '@game/shared/game-engine': `${shared}/game-engine/index.ts`,
      '@game/shared/data': `${shared}/data/truths.ts`,
      '@game/shared': `${shared}/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Node 24 下 forks pool 的 worker IPC 会崩（见 playbook §7.5）
    pool: 'threads',
  },
});
