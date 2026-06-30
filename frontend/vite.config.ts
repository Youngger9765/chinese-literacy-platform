import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  // Match the dev dependency pre-bundle target to the build target. Vite's
  // default optimizeDeps target includes safari14, which makes esbuild attempt
  // a destructuring down-level it can't do ("Transforming destructuring ... is
  // not supported yet") on deps like date-fns / d3-array / @floating-ui,
  // crashing `npm run dev`. esnext skips that lowering entirely. (#2428)
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'src/utils/encouragement.test.ts'],
  },
});
