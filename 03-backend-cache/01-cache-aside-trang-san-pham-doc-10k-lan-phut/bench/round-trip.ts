/**
 * Thời gian một vòng gọi từ host qua cổng Docker Desktop, tuần tự, không tải nền (nhật ký quyết định bài 02/04, mục 4):
 * Redis PING, Redis GET một sản phẩm đã cache (~1,1 KB), PostgreSQL SELECT 1, câu trang sản phẩm join 5 bảng.
 * Dùng để đọc độ trễ của lượt trúng / trượt cache: cùng một vòng mạng, khác nhau ở phần việc trong DB.
 *   RUN=main pnpm bench:rtt   → bench/results/<RUN>/round-trip.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { ProductRepository } from '../src/shared/product.repository';
import { benchRedis, percentile, round } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const N = Number(process.env.N ?? 5000);
mkdirSync(OUT, { recursive: true });

const db = createDb(loadConfig().databaseUrl, { max: 1 });
const redis = benchRedis();
await new Promise((r) => setTimeout(r, 300));
const repository = new ProductRepository(db);
const page = await repository.findPage(4242);
await redis.set('rtt:product', JSON.stringify(page));

async function measure(label: string, fn: (i: number) => Promise<unknown>) {
  for (let i = 0; i < 500; i++) await fn(i); // khởi động nóng
  const ms: number[] = [];
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    await fn(i);
    ms.push(performance.now() - start);
  }
  return { label, n: N, p50: round(percentile(ms, 50), 3), p95: round(percentile(ms, 95), 3), p99: round(percentile(ms, 99), 3) };
}

const hotIds = Array.from({ length: 500 }, (_, i) => 1 + ((i * 7919) % 200000));
const results = [
  await measure('Redis PING', () => redis.ping()),
  await measure('Redis GET sản phẩm đã cache', () => redis.get('rtt:product')),
  await measure('PostgreSQL SELECT 1', () => sql`SELECT 1`.execute(db)),
  await measure('Câu trang sản phẩm (500 id nóng)', (i) => repository.findPage(hotIds[i % 500]!)),
  await measure('Câu trang sản phẩm (id ngẫu nhiên)', () => repository.findPage(1 + Math.floor(Math.random() * 200000))),
];
await redis.del('rtt:product');
writeFileSync(join(OUT, 'round-trip.json'), JSON.stringify(results, null, 2));
console.table(results);
redis.disconnect();
await db.destroy();
