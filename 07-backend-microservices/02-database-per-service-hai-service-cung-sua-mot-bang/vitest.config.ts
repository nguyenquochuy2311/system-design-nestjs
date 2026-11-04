import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL có PGMQ đang chạy (pnpm db:up), không cần seed lớn. Mỗi test dựng lại schema bằng chính
// migration của từng service; service chạy ngay trong tiến trình test. Mọi file dùng chung database nên chạy tuần tự.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
