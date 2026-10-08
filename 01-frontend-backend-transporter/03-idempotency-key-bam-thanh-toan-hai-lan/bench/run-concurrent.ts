/**
 * Đo "giao dịch trùng khi 20 request đồng thời cùng khóa" (README mục 5, dòng 2): k6 20 VU × ROUNDS vòng, mỗi vòng
 * một ý định (cùng khóa, cùng payload) bắn cùng lúc; đếm `payments` theo mã ý định trong PostgreSQL.
 * Chạy: RUN=main ROUNDS=50 pnpm bench:concurrent   (VARIANTS=truoc,sau)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { createDb } from '../src/shared/db.js';
import { k6, startApi, versions } from './lib/api-process.js';
import { machineState, RESULTS_DIR, RUN, startSleepDetector, writeResult } from './lib/env.js';

const ROUNDS = process.env.ROUNDS ?? '50';
const VARIANTS = (process.env.VARIANTS ?? 'truoc,sau').split(',');
const OUT = process.env.OUT ?? 'concurrent';
const TAG = `${RUN}-${OUT}-${Date.now()}`;

const db = createDb({ max: 2 });
const api = await startApi(3100);
const sleep = startSleepDetector();
const env = { versions: await versions(), before: machineState() };
const variants: unknown[] = [];
try {
  for (const variant of VARIANTS) {
    const prefix = `${TAG}-${variant}`;
    const file = resolve(RESULTS_DIR, `${OUT}-${variant}.k6.json`);
    writeResult(`${OUT}-${variant}.k6.json`, {});
    const res = await k6(['run', '--quiet', '-e', `VARIANT=${variant}`, '-e', `ROUNDS=${ROUNDS}`, '-e', `PREFIX=${TAG}`, '-e', `OUT=${file}`, 'bench/concurrent-same-key.k6.js']);
    if (res.status !== 0) throw new Error(`k6 thoát mã ${res.status}`);
    const k6Summary = JSON.parse(readFileSync(file, 'utf8')) as { requests: number };
    const rows = await db
      .selectFrom('payments')
      .select(['note', sql<string>`count(*)`.as('n')])
      .where('note', 'like', `${prefix}-%`)
      .groupBy('note')
      .execute();
    const counts = rows.map((r) => Number(r.n));
    const keys = await db.selectFrom('idempotency_keys').select(sql<string>`count(*)`.as('n')).where('idempotency_key', 'like', `${prefix}-%`).executeTakeFirst();
    const summary = {
      variant, k6: k6Summary, intents: rows.length, payments: counts.reduce((a, b) => a + b, 0),
      excessPayments: counts.reduce((a, b) => a + b - 1, 0), maxPerIntent: Math.max(...counts), minPerIntent: Math.min(...counts),
      idempotencyKeyRows: Number(keys?.n ?? 0),
    };
    console.log(JSON.stringify(summary));
    variants.push(summary);
  }
} finally {
  await api.stop();
  await db.destroy();
}
const gaps = sleep.stop();
const file = writeResult(`${OUT}.json`, { rounds: Number(ROUNDS), tag: TAG, ...env, after: machineState(), sleepGaps: gaps, variants });
console.log(`→ ${file}${gaps.length ? ` · CẢNH BÁO: máy ngủ ${gaps.length} lần, chạy lại lượt này` : ''}`);
