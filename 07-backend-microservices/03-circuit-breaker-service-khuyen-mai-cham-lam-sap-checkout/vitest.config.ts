import { defineConfig } from 'vitest/config';

// Test không cần Docker: checkout chạy trong tiến trình test, promotion giả nghe một cổng thật và làm chậm theo lệnh.
// Độ trễ thật qua Toxiproxy nằm ở bench/run-slow-promotion.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
