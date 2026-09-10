import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  server: {
    port: 3000,
    host: '0.0.0.0',
    /*
     * 開發用的 /api 代理 —— 只在 VITE_API_URL 設成空字串時才會被用到。
     *
     * 為什麼需要：要在**實機**（iPad / 手機）上測本機這一份，裝置得連
     * Mac 的區網 IP。但那樣一來
     *   1. 後端 CORS 白名單沒有 http://<區網IP>:3000
     *   2. index.html 的 CSP connect-src 只允許 http://localhost:*
     * 兩道都會擋。把 API_BASE 留空（apiConfig.ts 用的是 `??`，空字串會保留）
     * 讓請求變成同源的 /api/*，這兩個問題就都不存在 —— 不必放寬 CSP，
     * 也不必把區網 IP 寫進任何白名單。
     */
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
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
    // One file at a time. Which test fails used to depend on how vitest packed
    // files onto workers, and that packing depends on the machine's core count:
    // the suite was green here, red in CI on TextManagementTab.copyright, and
    // red again locally on useFullTextTtsQueue once workers were capped at 2 to
    // match the runner. Three different answers for the same code.
    //
    // Something in this suite leaks across files. Serial execution is not the
    // cure for that, but it does make the gate reproducible, which is the part
    // that decides whether a red can be acted on or only re-run. Tracked so the
    // leak itself gets found rather than lived with.
    fileParallelism: false,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // 'e2e/**' never matched: the Playwright specs live in tests/e2e/, so
    // vitest kept collecting them and failing with "did not expect
    // test.describe() to be called here" -- five files that looked like broken
    // tests but were only ever in the wrong runner.
    exclude: ['tests/e2e/**', 'e2e/**', 'node_modules/**', 'src/utils/encouragement.test.ts'],
  },
});
