// Gói mỗi service thành MỘT file JS để pod node:20-alpine chạy thẳng mà không cần node_modules hay build image.
// Chạy tự động sau `pnpm install` và bằng `pnpm build` sau khi sửa mã nguồn.
import { build } from 'esbuild';

const apps = ['pricing', 'order'];

await Promise.all(
  apps.map((name) =>
    build({
      entryPoints: [`src/${name}/main.ts`],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: `dist/${name}.cjs`,
      logLevel: 'warning',
    }),
  ),
);
console.log(`đã build ${apps.map((name) => `dist/${name}.cjs`).join(', ')}`);
