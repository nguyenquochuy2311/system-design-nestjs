import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Test tích hợp: cần PostgreSQL của compose đang chạy (`docker compose up -d --wait`) và file .env (chép từ
// .env.example). Biến đã có trong môi trường được ưu tiên hơn .env, nên phép thử âm ghi đè được
// TEST_MIGRATION_DATABASE_URL bằng biến môi trường.
const fromFile = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(fromFile)) if (v !== undefined) env[k] = process.env[k] ?? v;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    env,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Các file cùng dùng database crm_test (xóa bảng, chạy migration) nên chạy tuần tự.
    fileParallelism: false,
  },
});
