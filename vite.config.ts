import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';

const VITE_ROOT = resolve(__dirname, 'src');
const OUT = resolve(__dirname, 'dist');

export default defineConfig({
  root: VITE_ROOT,
  publicDir: resolve(__dirname, 'public'),
  test: {
    include: ['../tests/**/*.test.ts'],
    environment: 'node',
  },
  build: {
    outDir: OUT,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(VITE_ROOT, 'popup/popup.html'),
        offscreen: resolve(VITE_ROOT, 'offscreen/offscreen.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'copy-public',
      closeBundle() {
        mkdirSync(OUT, { recursive: true });
        cpSync(resolve(__dirname, 'public'), OUT, { recursive: true });
      },
    },
  ],
});
