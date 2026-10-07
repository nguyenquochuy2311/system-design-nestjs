import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL và Redis đang chạy (pnpm db:up). Mỗi test tự tạo sản phẩm riêng nên không cần seed.
// Chạy tuần tự từng file vì các file dùng chung DB và Redis (một file dừng/treo Redis giả, đếm câu SQL theo tiến trình).
export default defineConfig({
  test: {
    setupFiles: ['test/support/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
