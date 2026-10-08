import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL và Toxiproxy đang chạy (pnpm db:up), KHÔNG cần seed. Mỗi file tự dựng lại schema
// `lab_test` nên chạy tuần tự, và không đụng dữ liệu của database chính dùng cho đo.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
