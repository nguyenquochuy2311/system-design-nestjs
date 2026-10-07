import { defineConfig } from 'vitest/config';

// Test tích hợp: cần Postgres đã seed (pnpm db:up && pnpm db:seed). Chạy tuần tự vì dùng chung DB.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
