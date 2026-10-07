import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Gốc của project pnpm là thư mục bài (cha của web/), nơi có node_modules và pnpm-lock.yaml.
  turbopack: { root: dirname(dirname(fileURLToPath(import.meta.url))) },
  poweredByHeader: false,
  // [PATTERN] Next tự sinh ETag cho HTML dựng sẵn (hash nội dung) và trả 304 khi If-None-Match khớp. Mặc định đã bật;
  // ghi tường minh để không ai tắt "cho nhẹ".
  generateEtags: true,
  async headers() {
    return [
      {
        // [PATTERN] HTML trang: no-cache = được lưu nhưng lần sau phải hỏi lại, nên luôn nhận HTML trỏ đúng bản JS mới.
        // /_next/static/* không nằm trong luật này: Next tự đặt "public, max-age=31536000, immutable" cho file băm tên
        // và không cho next.config ghi đè (README mục 3.4).
        source: '/((?!_next/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default config;
