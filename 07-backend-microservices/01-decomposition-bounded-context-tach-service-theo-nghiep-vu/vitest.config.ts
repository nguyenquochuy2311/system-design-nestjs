import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL có PGMQ đang chạy (pnpm db:up). Các service chạy ngay trong tiến trình test trên cổng
// ngẫu nhiên, nên "tắt Catalog" là đóng app đó. Mọi file dùng chung dữ liệu seed nên chạy tuần tự.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
