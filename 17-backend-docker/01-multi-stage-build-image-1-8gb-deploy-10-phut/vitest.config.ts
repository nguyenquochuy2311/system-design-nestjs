import { defineConfig } from 'vitest/config';

// Test của lab chạy lệnh docker thật trên host: build image, chạy container, đọc nội dung image.
// Chạy tuần tự (cùng cổng smoke test, cùng BuildKit) và cho thời gian dài vì có bước build.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
  },
});
