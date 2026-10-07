import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL và Redis đang chạy (pnpm db:up). Mỗi test tự tạo sản phẩm và danh mục riêng nên không cần seed.
// Chạy tuần tự từng file vì các file dùng chung DB, Redis, bảng outbox và key trang chủ.
export default defineConfig({
  test: {
    setupFiles: ['test/support/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
