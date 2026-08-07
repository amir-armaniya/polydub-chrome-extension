import { build } from 'esbuild';
import { rmSync } from 'node:fs';

await rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/background/service-worker.ts', 'src/content/content.ts'],
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  outbase: 'src',
  minify: true,
  sourcemap: false,
  target: 'es2022',
  logLevel: 'info',
});
