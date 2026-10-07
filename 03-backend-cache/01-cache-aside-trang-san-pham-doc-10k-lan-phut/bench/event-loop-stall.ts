/**
 * Kiểm một giả thuyết rút ra từ lượt đo: `commandTimeout` của ioredis đếm thời gian của tiến trình Node, không phải của Redis.
 * Gửi GET tới Redis đang khỏe, rồi chặn event loop BLOCK_MS (vòng lặp bận); Redis trả lời trong vài phần mười ms nhưng
 * timer 50 ms chạy trước khi Node đọc socket, nên lệnh vẫn báo "Command timed out". Đo với nhiều độ dài chặn.
 *   RUN=main pnpm bench:stall   → bench/results/<RUN>/event-loop-stall.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/shared/config';
import { createRedis } from '../src/shared/redis.client';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const TRIES = Number(process.env.TRIES ?? 20);
mkdirSync(OUT, { recursive: true });

const config = loadConfig();
const redis = createRedis(config.redisUrl, config.redisCommandTimeoutMs);
await new Promise<void>((r) => redis.once('ready', () => r()));
await redis.set('stall:probe', 'x');

const results: { blockMs: number; tries: number; timedOut: number; ok: number }[] = [];
for (const blockMs of [0, 20, 40, 60, 100, 500]) {
  let timedOut = 0;
  let ok = 0;
  for (let i = 0; i < TRIES; i++) {
    const pending = redis.get('stall:probe').then(
      () => ok++,
      (err: Error) => (err.message.includes('timed out') ? timedOut++ : Promise.reject(err)),
    );
    const until = Date.now() + blockMs;
    while (Date.now() < until) {
      // chặn event loop như một lần GC dài, một hàm đồng bộ nặng hay tiến trình bị hệ điều hành tạm dừng
    }
    await pending;
  }
  results.push({ blockMs, tries: TRIES, timedOut, ok });
}
await redis.del('stall:probe');
redis.disconnect();
writeFileSync(join(OUT, 'event-loop-stall.json'), JSON.stringify({ commandTimeoutMs: config.redisCommandTimeoutMs, results }, null, 2));
console.table(results);
