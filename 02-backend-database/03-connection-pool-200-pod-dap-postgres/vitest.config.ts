import { defineConfig } from 'vitest/config';

// Test tích hợp: cần Postgres và hai PgBouncer đang chạy (pnpm db:up). Không cần seed: mỗi test tự tạo ví riêng.
// Chạy tuần tự từng file: test "trước" cố ý làm PostgreSQL đầy kết nối, chạy song song sẽ làm hỏng file khác.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
