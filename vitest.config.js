/**
 * Vitest 配置
 *
 * 复用 Vite 的 React 插件，测试环境用 jsdom。
 * 注意： deliberately 不 import 主 vite.config.js 的代理探测逻辑，
 *       避免测试启动时卡在代理检测。
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/search/**', 'src/components/search/**'],
    },
  },
})
