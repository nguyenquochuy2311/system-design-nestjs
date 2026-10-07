// Tiến trình worker invalidation của bản sau: pnpm worker. Chạy nhiều bản cùng lúc được (SKIP LOCKED).
import { once } from 'node:events';
import { InvalidationWorker } from './sau/invalidation.worker';
import { loadConfig, num } from './shared/config';
import { createDb } from './shared/db';
import { createRedis } from './shared/redis.client';

const config = loadConfig();
const opts = { batchSize: num('WORKER_BATCH', 500), pollMs: num('WORKER_POLL_MS', 500), unlinkChunk: 500 };
const db = createDb(config.databaseUrl, { max: 2 });
const redis = createRedis(config.redisUrl, num('WORKER_REDIS_TIMEOUT_MS', 500), 'worker.redis');
await Promise.race([once(redis, 'ready'), new Promise((r) => setTimeout(r, 5_000))]); // Redis chưa lên thì vòng lặp tự thử lại

const worker = new InvalidationWorker(db, redis, opts, true);
worker.start();
console.log(`worker invalidation chạy: poll ${opts.pollMs} ms, lô ${opts.batchSize} sự kiện, pid ${process.pid}`);

const shutdown = async () => {
  await worker.stop();
  redis.disconnect();
  await db.destroy();
  console.log(`worker dừng: ${JSON.stringify(worker.stats)}`);
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
