import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// LAB_CACHE_COMPONENTS=1 chỉ dùng cho bench/router-cache-check.ts: bật Cache Components (Next giữ trang cũ bằng
// <Activity> thay vì unmount) vào một thư mục build riêng, để so hành vi quay lại trang giữa hai chế độ của Next 16.
const cacheComponents = process.env.LAB_CACHE_COMPONENTS === '1';

const config: NextConfig = {
  // Gốc của project pnpm là thư mục bài (cha của web/), nơi có node_modules và pnpm-lock.yaml.
  turbopack: { root: dirname(dirname(fileURLToPath(import.meta.url))) },
  poweredByHeader: false,
  distDir: cacheComponents ? '.next-cache-components' : '.next',
  ...(cacheComponents ? { cacheComponents: true, partialPrefetching: true } : {}),
  // Trình duyệt gọi API cùng origin (/api/*); Next chuyển tiếp tới API NestJS ở 3100 kèm cookie uid.
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:3100/api/:path*' }];
  },
};

export default config;
