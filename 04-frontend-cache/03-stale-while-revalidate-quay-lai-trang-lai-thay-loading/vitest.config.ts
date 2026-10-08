import { defineConfig } from 'vitest/config';

// Test tích hợp trên Next.js production (3200), API NestJS (3100) và Google Chrome hệ thống: globalSetup build web/
// (nếu mã nguồn đổi) rồi bật hai tiến trình một lần cho cả lượt; các file chạy tuần tự vì dùng chung dữ liệu của API.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 180_000,
  },
});
