// Gói mỗi service thành MỘT file JS (dist/<service>.mjs) có sẵn fastify, pg và OpenTelemetry, để container
// node:20-alpine chạy thẳng mà không cần node_modules (node_modules trên host là bản macOS). Chạy tự động sau
// `pnpm install` (postinstall) và bằng `pnpm build` sau khi sửa mã nguồn. Mẫu: bài 02/03.
import { build } from 'esbuild';

const services = ['gateway', 'checkout', 'promotion'];
await Promise.all(
  services.map((name) =>
    build({
      entryPoints: [`services/${name}/main.ts`],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile: `dist/${name}.mjs`,
      external: ['pg-native'], // pg chỉ nạp bản native khi được yêu cầu; lab dùng bản JavaScript
      // fastify, pg và OpenTelemetry có phần CommonJS: cho phép chúng gọi require() bên trong file ESM
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: 'warning',
    }),
  ),
);
console.log(`đã build ${services.map((s) => `dist/${s}.mjs`).join(', ')}`);
