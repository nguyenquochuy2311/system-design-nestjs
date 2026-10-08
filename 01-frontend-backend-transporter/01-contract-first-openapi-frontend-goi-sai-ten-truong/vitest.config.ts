import { defineConfig } from 'vitest/config';

// Mọi test chạy trên host, không container nào ngoài `docker run` một lần cho oasdiff (image ghim tag).
// Backend trong test nghe cổng ngẫu nhiên; Prism (mock) dùng cổng 3101 nên chỉ một file bật nó.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
