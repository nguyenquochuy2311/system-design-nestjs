import { randomBytes } from 'node:crypto';
import { buildApp } from './app.js';
import { createDb } from './shared/db.js';

const secret = process.env.CURSOR_SECRET || randomBytes(32).toString('base64url');
if (!process.env.CURSOR_SECRET) console.warn('CURSOR_SECRET trống: dùng khóa ngẫu nhiên, cursor cũ hết hiệu lực khi khởi động lại.');

const db = createDb({ max: Number(process.env.DB_POOL_MAX ?? 10) });
const app = buildApp({ db, cursorSecret: secret });
const port = Number(process.env.PORT ?? 3100);
await app.listen({ port, host: '127.0.0.1' });
console.log(`API lắng nghe tại http://127.0.0.1:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => db.destroy()).then(() => process.exit(0));
  });
}
