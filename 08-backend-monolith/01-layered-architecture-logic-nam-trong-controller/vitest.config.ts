import { defineConfig } from 'vitest/config';

// Ba nhóm test:
// - unit: domain, service và cả module NestJS với repository giả trong bộ nhớ — KHÔNG cần DB.
// - arch: luật phụ thuộc (dependency-cruiser) và độ dài/độ phức tạp hàm (ESLint) — không cần DB.
// - e2e: HTTP + PostgreSQL thật (pnpm db:up); chạy tuần tự từng file vì dùng chung DB.
export default defineConfig({
  test: {
    setupFiles: ['test/support/setup.ts'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      { extends: true, test: { name: 'arch', include: ['test/architecture/**/*.test.ts'], testTimeout: 60_000 } },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/sau/orders/**/*.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
});
