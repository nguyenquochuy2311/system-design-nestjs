/**
 * So độ trễ HTTP của luồng đặt hàng web giữa hai bản để xem phân lớp có làm chậm đáng kể không.
 * Script tự bật API (tsx src/main.ts ở PORT), chạy khởi động WARMUP mỗi bản, rồi ROUNDS vòng; mỗi vòng chạy
 * cả hai bản, thứ tự đảo giữa các vòng; trước mỗi lượt k6 xóa bảng đơn để lượt nào cũng bắt đầu như nhau.
 *   pnpm db:seed && RUN=main ROUNDS=5 DURATION=20s VUS=10 pnpm bench:http
 * Kết quả: bench/results/<RUN>/http/<variant>-r<n>.json (k6 --summary-export) và http-overhead.json.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import { createDb } from '../src/shared/db';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const DURATION = process.env.DURATION ?? '20s';
const WARMUP = process.env.WARMUP ?? '10s';
const VUS = process.env.VUS ?? '10';
const PORT = process.env.PORT ?? '3100';
const BASE_URL = `http://127.0.0.1:${PORT}`;
mkdirSync(join(OUT, 'http'), { recursive: true });

const db = createDb();
const ids = async (table: 'customers' | 'products', prefix: string) =>
  (await sql<{ id: number }>`SELECT id FROM ${sql.table(table)} WHERE ${sql.ref(table === 'customers' ? 'code' : 'sku')} LIKE ${prefix + '%'} ORDER BY id`.execute(db)).rows.map((r) => r.id);
const customers = await ids('customers', 'BENCH-C');
const products = await ids('products', 'BENCH-P');
if (customers.length === 0 || products.length === 0) throw new Error('Chưa có dữ liệu đo: chạy pnpm db:seed trước');

// API chạy như `pnpm dev` nhưng là một tiến trình node duy nhất (`node --import tsx`), để tắt chắc chắn khi xong.
const server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  env: { ...process.env, PORT },
  stdio: ['ignore', openSync(join(OUT, 'http', 'server.log'), 'a'), openSync(join(OUT, 'http', 'server.log'), 'a')],
});
const stopServer = () => server.kill('SIGTERM');
process.on('exit', stopServer);
for (let i = 0; ; i++) {
  try {
    await fetch(`${BASE_URL}/`);
    break;
  } catch {
    if (i > 100) throw new Error('API không lên');
    await sleep(200);
  }
}

interface Result {
  variant: string;
  round: number;
  reqs: number;
  rps: number;
  med: number;
  p95: number;
  p99: number;
  checksFailed: number;
  load1Before: number;
}

async function k6(variant: string, duration: string, file: string, round: number): Promise<Result> {
  await sql`TRUNCATE order_items, orders`.execute(db);
  const load1Before = Number((loadavg()[0] ?? 0).toFixed(2));
  const res = spawnSync(
    'k6',
    ['run', '--quiet', '-e', `VARIANT=${variant}`, '-e', `BASE_URL=${BASE_URL}`, '-e', `VUS=${VUS}`, '-e', `DURATION=${duration}`,
      '-e', `CUSTOMERS=${customers.join(',')}`, '-e', `PRODUCTS=${products.join(',')}`, '--summary-export', file, 'bench/place-order.k6.js'],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) throw new Error(`k6 lỗi (${variant}):\n${res.stdout}\n${res.stderr}`);
  const m = JSON.parse(readFileSync(file, 'utf8')).metrics;
  const d = m.http_req_duration;
  return {
    variant, round, reqs: m.http_reqs.count, rps: Number(m.http_reqs.rate.toFixed(1)),
    med: Number(d.med.toFixed(3)), p95: Number(d['p(95)'].toFixed(3)), p99: Number(d['p(99)'].toFixed(3)),
    checksFailed: m.checks.fails, load1Before,
  };
}

const VARIANTS = ['truoc', 'sau'];
const results: Result[] = [];
try {
  for (const v of VARIANTS) console.log('khởi động', JSON.stringify(await k6(v, WARMUP, join(OUT, 'http', `warmup-${v}.json`), 0)));
  for (let round = 1; round <= ROUNDS; round++) {
    const order = round % 2 === 1 ? VARIANTS : [...VARIANTS].reverse();
    for (const v of order) {
      const r = await k6(v, DURATION, join(OUT, 'http', `${v}-r${round}.json`), round);
      results.push(r);
      console.log(JSON.stringify(r));
    }
  }
} finally {
  stopServer();
  await db.destroy();
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const stat = (v: string, k: 'med' | 'p95' | 'p99' | 'rps' | 'reqs') => {
  const xs = results.filter((r) => r.variant === v).map((r) => r[k]);
  return { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };
};
const perRoundDelta = (k: 'med' | 'p95' | 'p99') =>
  Array.from({ length: ROUNDS }, (_, i) => {
    const get = (v: string) => results.find((r) => r.variant === v && r.round === i + 1)?.[k] ?? NaN;
    return Number((get('sau') - get('truoc')).toFixed(3));
  });
const summary = {
  env: { ROUNDS, DURATION, WARMUP, VUS, customers: customers.length, products: products.length },
  truoc: { med: stat('truoc', 'med'), p95: stat('truoc', 'p95'), p99: stat('truoc', 'p99'), rps: stat('truoc', 'rps'), reqs: stat('truoc', 'reqs') },
  sau: { med: stat('sau', 'med'), p95: stat('sau', 'p95'), p99: stat('sau', 'p99'), rps: stat('sau', 'rps'), reqs: stat('sau', 'reqs') },
  deltaSauMinusTruoc: { med: perRoundDelta('med'), p95: perRoundDelta('p95'), p99: perRoundDelta('p99') },
};
writeFileSync(join(OUT, 'http-overhead.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 1));
