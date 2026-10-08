import { defineConfig } from 'vitest/config';

// Test của lab chạy `docker buildx build` thật trên builder riêng của lab (driver docker-container).
// Chạy tuần tự (cùng builder, cùng bản sao context) và cho thời gian dài vì có bước build lạnh.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
  },
});
