// Gói mỗi ứng dụng thành MỘT file JS (dist/<app>.cjs) để container node:20-alpine chạy thẳng mà không cần node_modules
// (nhật ký 2026-11-04 điểm 1). Chạy tự động sau `pnpm install` và bằng `pnpm build` sau khi sửa mã nguồn.
import { build } from 'esbuild';

const apps = ['truoc', 'order-service', 'shipping-service'];

// NestJS nạp các gói tùy chọn này trong try/catch khi có dùng; lab không dùng nên để ngoài bundle.
const optionalNestPackages = [
  '@nestjs/microservices',
  '@nestjs/microservices/*',
  '@nestjs/websockets',
  '@nestjs/websockets/*',
  'class-transformer',
  'class-transformer/*',
  'class-validator',
];

await Promise.all(
  apps.map((name) =>
    build({
      entryPoints: [`apps/${name}/main.ts`],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: `dist/${name}.cjs`,
      external: ['pg-native', ...optionalNestPackages],
      logLevel: 'warning',
    }),
  ),
);
console.log(`đã build ${apps.map((name) => `dist/${name}.cjs`).join(', ')}`);
