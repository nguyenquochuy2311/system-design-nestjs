import { defineConfig } from 'vitest/config';

// Test trong test/cluster cần k3s đang chạy (pnpm stack:up); tự apply manifest nên không cần chuẩn bị thêm.
// Mọi file dùng chung một cluster nên chạy tuần tự.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
