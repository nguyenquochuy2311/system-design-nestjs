/**
 * Máy chủ gốc của trang (Next.js production, `next build web` trước). Hai việc ngoài Next:
 *  1. Ghi log truy cập (ACCESS_LOG) để đếm request tới máy chủ gốc — chỉ số "request tới gốc mỗi phút".
 *  2. CACHE_MODE=truoc tái hiện hiện trạng của bài: một lớp "bảo mật" ở máy gốc ép `no-store` và bỏ ETag/Last-Modified
 *     cho MỌI response ngay trước khi ghi header, kể cả /_next/static. next.config không làm được việc này vì Next
 *     không cho ghi đè Cache-Control của file băm tên; triệu chứng "JS tải lại mỗi lần" chỉ xảy ra khi có một lớp
 *     đứng trước Next như thế này (custom server, proxy của máy gốc).
 *   CACHE_MODE=sau (mặc định) để nguyên header của Next + next.config.
 */
import { createWriteStream } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';

const mode = process.env.CACHE_MODE === 'truoc' ? 'truoc' : 'sau';
const port = Number(process.env.WEB_PORT ?? 3200);
const host = process.env.WEB_HOST ?? '127.0.0.1';
const accessLog = process.env.ACCESS_LOG ? createWriteStream(process.env.ACCESS_LOG, { flags: 'a' }) : null;

/** Bản trước: chặn writeHead (cùng cách gói on-headers làm) để header cuối cùng luôn là no-store. */
function forceNoStore(res: ServerResponse): void {
  const writeHead = res.writeHead;
  res.writeHead = function patched(this: ServerResponse, ...args: unknown[]) {
    this.setHeader('Cache-Control', 'no-store');
    this.removeHeader('ETag');
    this.removeHeader('Last-Modified');
    // writeHead(status, headers) với object header: header trong object thắng setHeader, nên sửa cả ở đó.
    const headers = args.find((a, i) => i > 0 && a !== null && typeof a === 'object' && !Array.isArray(a)) as Record<string, unknown> | undefined;
    if (headers) {
      for (const k of Object.keys(headers)) {
        const lower = k.toLowerCase();
        if (lower === 'cache-control') headers[k] = 'no-store';
        if (lower === 'etag' || lower === 'last-modified') delete headers[k];
      }
    }
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as ServerResponse['writeHead'];
}

const app = next({ dev: false, dir: dirname(fileURLToPath(import.meta.url)), hostname: host, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  if (req.url === '/__ops/health') {
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: true, mode, pid: process.pid }));
    return;
  }
  if (accessLog) {
    const started = Date.now();
    res.on('finish', () => {
      accessLog.write(`${JSON.stringify({ t: started, m: req.method, u: req.url, s: res.statusCode, inm: req.headers['if-none-match'] ?? null })}\n`);
    });
  }
  if (mode === 'truoc') forceNoStore(res);
  void handle(req, res);
}).listen(port, host, () => {
  console.log(`web (${mode}) ở http://${host}:${port}, pid ${process.pid}`);
});
