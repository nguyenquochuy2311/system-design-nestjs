import { defineConfig } from 'vitest/config';

// Test tích hợp chạy tuần tự từng file: nhiều file dùng chung CDN Nginx (58088), thư mục deploy .data/www, API ở
// 3100/3101 và Chrome hệ thống. globalSetup kiểm CDN và nạp lại cấu hình Nginx.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
