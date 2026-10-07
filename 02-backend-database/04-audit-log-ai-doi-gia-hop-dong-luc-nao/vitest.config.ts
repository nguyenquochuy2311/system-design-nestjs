import { defineConfig } from 'vitest/config';

// Test tích hợp: cần Postgres và PgBouncer đang chạy (pnpm db:up). globalSetup áp dụng migration (chạy lại được),
// mỗi test tự tạo hợp đồng riêng nên không cần seed. Chạy tuần tự từng file vì test PgBouncer dùng chung
// một kết nối thật (database insurance_one).
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
