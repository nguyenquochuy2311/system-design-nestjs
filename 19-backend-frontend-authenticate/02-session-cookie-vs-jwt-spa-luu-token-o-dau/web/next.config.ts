import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Gốc project pnpm là thư mục bài (cha của web/), nơi có node_modules và pnpm-lock.yaml.
  turbopack: { root: dirname(dirname(fileURLToPath(import.meta.url))) },
  poweredByHeader: false,
  // Trình duyệt gọi API CÙNG ORIGIN qua /api/*; Next chuyển tiếp tới API NestJS ở 3100 (bỏ tiền tố /api).
  // Cùng origin là điều kiện để cookie __Host-sid + SameSite hoạt động (không CORS, không cross-site).
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:3100/:path*' }];
  },
};

export default config;
