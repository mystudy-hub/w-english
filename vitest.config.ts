import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,mjs}'], restoreMocks: true,
    // 本机在 30 个 jsdom 环境并行 + 子进程工具用例下会超过 10 秒；30 秒仍能拦住真正的挂死。
    testTimeout: 30_000,
  },
});
