import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Test tích hợp: cần cả stack của compose đang chạy (`docker compose up -d --wait`) và file .env (chép từ
// .env.example). Test kiểm DỮ LIỆU THẬT trong Prometheus (sau khi đi qua SDK → Collector → scrape → rule), không đọc
// file cấu hình. Biến môi trường có sẵn được ưu tiên hơn .env (nhật ký 17/05 điểm 6).
const fromFile = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(fromFile)) if (v !== undefined) env[k] = process.env[k] ?? v;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env,
    // Mỗi lần chờ dữ liệu đi hết đường ống (đẩy 5 s + scrape 5 s + rule 5 s) mất tới khoảng 20 s.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Các file dùng chung một Prometheus và Toxiproxy (test lỗi tắt proxy DB) nên chạy tuần tự.
    fileParallelism: false,
  },
});
