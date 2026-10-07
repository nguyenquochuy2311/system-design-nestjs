import { defineConfig } from 'vitest/config';

// Test tích hợp. Một số file bật API (3100, 3101, 3102) và trang Next.js (3200) thành tiến trình riêng, và gọi qua CDN
// Nginx ở 58088 (docker compose up -d), nên chạy tuần tự từng file. globalSetup sinh ảnh và build Next nếu còn thiếu.
export default defineConfig({
  test: {
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
