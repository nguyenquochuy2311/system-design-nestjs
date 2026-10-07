import { buildApp } from './app';
import { createDb } from './shared/db';

const db = createDb();
const app = buildApp(db, { logLevel: process.env.LOG_LEVEL ?? 'warn' });

const port = Number(process.env.PORT ?? 3100);
await app.listen({ port, host: '127.0.0.1' });
console.log(`API vận đơn lắng nghe tại http://127.0.0.1:${port}`);

// Tắt gọn khi Ctrl+C / kill: đóng HTTP rồi đóng pool, không để kết nối DB treo.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
}
