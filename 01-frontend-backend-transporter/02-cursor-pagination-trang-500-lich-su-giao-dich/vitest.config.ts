import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL đang chạy (pnpm db:up); KHÔNG cần seed lớn. Mỗi file tự dựng lại schema `lab_test`
// và tự sinh dữ liệu nhỏ, nên chạy tuần tự (dùng chung schema đó) và không đụng bảng seed dùng cho đo.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
