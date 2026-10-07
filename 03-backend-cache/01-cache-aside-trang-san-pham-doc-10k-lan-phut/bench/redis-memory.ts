/**
 * Bộ nhớ Redis cho toàn bộ 200.000 sản phẩm (mục 5): xóa cache, gọi GET /sau/products/:id cho mọi id qua API thật
 * (cùng đường nạp cache, cùng JSON), rồi đọc INFO memory, DBSIZE và MEMORY USAGE của một mẫu key.
 * Cache để nguyên sau khi chạy: lượt `NAME=sau-full FLUSH=0 WARMUP_S=0 pnpm bench:load` ngay sau đó đo khi cache đã chứa đủ
 * (trong vòng TTL 10 phút).
 *   RUN=main pnpm bench:memory   → bench/results/<RUN>/redis-memory.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { BASE, benchRedis, productQueryStats, round, startApi } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 32);
mkdirSync(OUT, { recursive: true });

const db = createDb(loadConfig().databaseUrl, { max: 2 });
const redis = benchRedis();
await new Promise((r) => setTimeout(r, 300));
const maxId = Number((await sql<{ n: number }>`SELECT max(id)::int AS n FROM products WHERE id <= 200000`.execute(db)).rows[0]?.n);

const info = async () => {
  const text = (await redis.info('memory')) + (await redis.info('stats'));
  const f = (k: string) => /^\d+(\.\d+)?$/.test(new RegExp(`^${k}:(\\S+)`, 'm').exec(text)?.[1] ?? '') ? Number(new RegExp(`^${k}:(\\S+)`, 'm').exec(text)?.[1]) : new RegExp(`^${k}:(\\S+)`, 'm').exec(text)?.[1];
  return {
    used_memory: f('used_memory'),
    used_memory_human: f('used_memory_human'),
    used_memory_dataset: f('used_memory_dataset'),
    used_memory_rss: f('used_memory_rss'),
    mem_fragmentation_ratio: f('mem_fragmentation_ratio'),
    maxmemory: f('maxmemory'),
    maxmemory_policy: f('maxmemory_policy'),
    evicted_keys: f('evicted_keys'),
    keys: await redis.dbsize(),
  };
};

const api = await startApi(join(OUT, 'redis-memory-api.log'));
try {
  await redis.flushall();
  await redis.config('RESETSTAT');
  await sql`SELECT pg_stat_statements_reset()`.execute(db);
  const before = await info();
  const started = Date.now();
  let next = 1;
  let failed = 0;
  const sources: Record<string, number> = {};
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next <= maxId) {
        const id = next++;
        const res = await fetch(`${BASE}/sau/products/${id}`);
        await res.arrayBuffer();
        if (res.status !== 200) failed++;
        const src = res.headers.get('x-cache') ?? 'NONE';
        sources[src] = (sources[src] ?? 0) + 1;
      }
    }),
  );
  const fillSeconds = (Date.now() - started) / 1000;
  const after = await info();
  // Mẫu 2.000 key ngẫu nhiên: độ dài JSON và bộ nhớ Redis tính cho mỗi key (gồm key, giá trị, TTL, overhead).
  const sample: { strlen: number; usage: number }[] = [];
  for (let i = 0; i < 2000; i++) {
    const key = `product:v1:${1 + Math.floor(Math.random() * maxId)}`;
    const [strlen, usage] = await Promise.all([redis.strlen(key), redis.call('MEMORY', 'USAGE', key) as Promise<number | null>]);
    if (usage !== null) sample.push({ strlen, usage });
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const result = {
    products: maxId,
    concurrency: CONCURRENCY,
    fillSeconds: round(fillSeconds, 1),
    failed,
    sources,
    dbProductQueryCalls: (await productQueryStats(db)).calls,
    before,
    after,
    deltaUsedMemoryMb: round((Number(after.used_memory) - Number(before.used_memory)) / 1024 / 1024, 1),
    bytesPerKey: round((Number(after.used_memory) - Number(before.used_memory)) / (after.keys - before.keys), 0),
    sample: { keys: sample.length, avgJsonBytes: round(avg(sample.map((s) => s.strlen)), 0), avgMemoryUsageBytes: round(avg(sample.map((s) => s.usage)), 0) },
  };
  writeFileSync(join(OUT, 'redis-memory.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally {
  await api.stop();
  redis.disconnect();
  await db.destroy();
}
