import { defineConfig } from 'vitest/config';

// Test tích hợp: cần Postgres đang chạy (pnpm db:up). Mỗi test tự tạo vận đơn riêng nên không cần seed;
// vẫn chạy tuần tự từng file để các test "đồng thời" không tranh connection với file khác.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
