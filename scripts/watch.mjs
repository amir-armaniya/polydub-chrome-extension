import { build } from 'esbuild';

const ctx = await build({
  entryPoints: ['src/background/service-worker.ts', 'src/content/content.ts'],
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  outbase: 'src',
  minify: true,
  sourcemap: false,
  target: 'es2022',
  watch: true,
  logLevel: 'info',
});

console.log('Watching extension scripts (esbuild)...');
process.on('SIGINT', async () => {
  await ctx.stop();
  process.exit(0);
});
