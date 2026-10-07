// Một "pod" API: một tiến trình Node có pool kết nối riêng, chạy trong container (service `api` của docker-compose.yml,
// nhân bản bằng `docker compose up --scale api=N`). Ghi sự kiện ra stdout dạng JSON để bench đếm.
import { hostname } from 'node:os';
import { buildApp } from './app';
import { classifyDbError } from './shared/db-errors';
import { createDirectPool } from './truoc/db-pool';
import { createPooledPool } from './sau/db-pool';

const mode = process.env.MODE === 'truoc' ? 'truoc' : 'sau';
const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? '127.0.0.1';
const podName = process.env.POD_NAME ?? `pod-${hostname()}`;
// Chọn instance PgBouncer theo hostname (id container ngẫu nhiên): các pod chia gần đều cho hai instance.
const podIndex = Number(process.env.POD_INDEX ?? (parseInt(hostname().slice(0, 8), 16) || 0));

function log(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: Date.now(), pod: podName, mode, ...event }));
}

const pool = mode === 'truoc' ? createDirectPool(podIndex) : createPooledPool(podIndex);
// Kết nối rảnh trong pool bị đóng từ phía server (PgBouncer KILL, DB khởi động lại): ghi log, không để tiến trình chết.
pool.on('error', (err) => log({ event: 'idle_client_error', message: err.message }));

// Khởi động như app NestJS/TypeORM: kết nối DB lúc boot, không được thì thoát mã 1 để orchestrator khởi động lại
// (restart: on-failure). Đây là vòng "readiness thất bại -> khởi động lại -> thêm một đợt kết nối" ở mục 1 README.
try {
  await pool.query('SELECT 1');
} catch (err) {
  log({ event: 'readiness_failed', kind: classifyDbError(err) ?? 'other', message: (err as Error).message });
  await pool.end().catch(() => undefined);
  process.exit(1);
}

const app = buildApp(pool, { podName, logLevel: process.env.LOG_LEVEL ?? 'error' });
await app.listen({ port, host });
log({ event: 'ready', podIndex });

async function shutdown(): Promise<void> {
  await app.close();
  await pool.end();
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
