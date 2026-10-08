import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL và Redis đang chạy (pnpm db:up), KHÔNG cần seed lớn. Mỗi file tự dựng lại
// schema `lab_test` và tự chèn vài user nên chạy tuần tự, không đụng database chính dùng cho đo/tấn công.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
