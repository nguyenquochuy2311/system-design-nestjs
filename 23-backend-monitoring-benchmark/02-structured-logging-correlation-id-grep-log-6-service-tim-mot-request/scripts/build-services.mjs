// Gói mỗi service thành MỘT file JS (dist/<service>.mjs) có sẵn fastify, pino, bullmq và OpenTelemetry, để container
// node:20-alpine chạy thẳng mà không cần node_modules (node_modules trên host là bản macOS). Chạy tự động sau
// `pnpm install` (postinstall) và bằng `pnpm build` sau khi sửa mã nguồn. Mẫu: bài 02/03, 23/01.
import { build } from 'esbuild';

const services = ['gateway', 'topup', 'bank-adapter', 'ledger'];
await Promise.all(
  services.map((name) =>
    build({
      entryPoints: [`services/${name}/main.ts`],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile: `dist/${name}.mjs`,
      // pino chỉ nạp thread-stream/worker khi dùng `transport`; lab ghi thẳng stdout nên không cần.
      // fastify, pino, bullmq, ioredis có phần CommonJS: cho phép chúng gọi require() bên trong file ESM.
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: 'warning',
    }),
  ),
);
console.log(`đã build ${services.map((s) => `dist/${s}.mjs`).join(', ')}`);
