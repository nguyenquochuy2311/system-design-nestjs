import { defineConfig } from 'vitest/config';

// Mọi test chạy trên PostgreSQL (PGMQ) và RustFS thật (`pnpm db:up`), tuần tự từng file vì dùng chung DB và đo thời gian.
export default defineConfig({
  test: {
    setupFiles: ['test/support/setup.ts'],
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
