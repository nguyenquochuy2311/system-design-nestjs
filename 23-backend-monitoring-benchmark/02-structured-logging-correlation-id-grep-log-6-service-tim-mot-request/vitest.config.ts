import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Test tích hợp: cần cả stack của compose đang chạy (`docker compose up -d --wait`) và file .env (chép từ
// .env.example). Test kiểm LOG THẬT: dòng đã vào Loki (stdout → file json-file → Collector → Loki) và stdout của
// container (`docker compose logs`), không đọc code hay cấu hình. Biến môi trường có sẵn ưu tiên hơn .env (nhật ký 17/05).
const fromFile = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(fromFile)) if (v !== undefined) env[k] = process.env[k] ?? v;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env,
    // Chờ log đi hết đường ống thường dưới 2 s; lề rộng cho máy bận.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Các file đọc chung cửa sổ thời gian của Loki và stdout: chạy tuần tự để dòng của file này không lẫn file kia.
    fileParallelism: false,
  },
});
