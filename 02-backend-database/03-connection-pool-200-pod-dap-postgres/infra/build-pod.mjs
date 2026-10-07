// Build src/pod.ts thành MỘT file JS có sẵn fastify và pg (dist/pod.mjs), để container node:20-alpine chạy thẳng,
// không cần node_modules trong container. Chạy: pnpm build
import { build } from 'esbuild';

await build({
  entryPoints: ['src/pod.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/pod.mjs',
  external: ['pg-native'], // pg chỉ nạp bản native khi được yêu cầu; lab dùng bản JavaScript
  // pg và fastify là CommonJS: cho phép chúng gọi require() bên trong file ESM
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log('đã build dist/pod.mjs');
