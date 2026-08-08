/**
 * 打包服务端。
 *
 * ★ 为什么要 bundle 而不是 tsc 直接输出：
 *   引擎源码在 packages/shared，tsc 不会重写产物里的 `@game/shared` 导入，
 *   Node 运行时会沿 workspace 符号链接解析到原始 .ts 而崩掉
 *   （ERR_MODULE_NOT_FOUND: .../shared/src/game-engine/rng.js）。
 *   把 shared 一起打进单文件最省事，同时保证「引擎只有一份源码」。
 *
 *   第三方依赖保持 external（走 node_modules），只内联 @game/shared。
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'build/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // 只内联我们自己的 workspace 包，其余留给 node_modules
  external: ['colyseus', '@colyseus/*', 'express', 'cors'],
  logLevel: 'info',
});
