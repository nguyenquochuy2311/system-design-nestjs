/**
 * Đo "giao dịch trùng khi response bị cắt" (README mục 5, dòng 1). Với mỗi ý định thanh toán:
 *   lần gửi 1 đi qua Toxiproxy đang bật toxic cắt response → API xử lý, commit, response bị bỏ, client nhận lỗi;
 *   tắt toxic → client gửi lại cùng ý định (cùng Idempotency-Key) → nhận response.
 * Sau đó đếm `payments` theo mã ý định trong PostgreSQL. Ý định chạy tuần tự (toxic áp cho cả proxy).
 * Chạy: RUN=main N=1000 SEED=20261008 pnpm bench:cut   (VARIANTS=truoc,sau; CUT_MODE=timeout TIMEOUT_MS=300 OUT=cut-timeout)
 */
import { sql } from 'kysely';
import { PaymentClient, type PayOutcome } from '../src/shared/payment-client.js';
import { createDb } from '../src/shared/db.js';
import { startApi, versions } from './lib/api-process.js';
import { machineState, RUN, startSleepDetector, writeResult } from './lib/env.js';
import { CUT_MODE, cutResponses, pointProxyTo, PROXY_URL } from './lib/toxiproxy.js';

const N = Number(process.env.N ?? 1000);
const SEED = Number(process.env.SEED ?? 20261008);
const VARIANTS = (process.env.VARIANTS ?? 'truoc,sau').split(',');
const OUT = process.env.OUT ?? 'cut';
const TAG = `${RUN}-${OUT}-${Date.now()}`;
/** Thời gian client chờ mỗi lần gửi (app thật: 10 giây). Với CUT_MODE=timeout đây là thời gian mất cho mỗi lần bị cắt. */
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2_000);

/** PRNG có hạt (mulberry32): hai bản nhận cùng chuỗi người dùng và số tiền. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const db = createDb({ max: 2 });
const api = await startApi(3100);
await pointProxyTo(3100);
const sleep = startSleepDetector();
const env = { versions: await versions(), before: machineState() };
const variants: unknown[] = [];
try {
  for (const variant of VARIANTS) {
    const rand = prng(SEED);
    const client = new PaymentClient({ baseUrl: PROXY_URL, path: `/${variant}/payments`, timeoutMs: TIMEOUT_MS, maxAttempts: 5, backoffMs: 5, keepAlive: CUT_MODE === 'timeout' });
    const prefix = `${TAG}-${variant}-`;
    const outcomes: { note: string; amount: number; outcome?: PayOutcome; error?: string; attempts?: unknown }[] = [];
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const userId = String(1 + Math.floor(rand() * 10_000));
      const amount = 1_000 * (1 + Math.floor(rand() * 500));
      const merchantId = 1 + Math.floor(rand() * 200);
      const note = `${prefix}${i}`;
      try {
        // Lần gửi 1: bật cắt response; các lần sau: tắt.
        const outcome = await client.pay({ userId, merchantId, amount, note }, (attempt) => cutResponses(attempt === 1));
        outcomes.push({ note, amount, outcome });
      } catch (err) {
        outcomes.push({ note, amount, error: (err as Error).message, attempts: (err as { attempts?: unknown }).attempts });
      }
    }
    await cutResponses(false);
    const seconds = (Date.now() - t0) / 1000;

    const rows = await db
      .selectFrom('payments')
      .select(['note', sql<string>`count(*)`.as('n'), sql<string>`sum(amount)`.as('amount'), sql<string[]>`array_agg(id::text ORDER BY id)`.as('ids')])
      .where('note', 'like', `${prefix}%`)
      .groupBy('note')
      .execute();
    const byNote = new Map(rows.map((r) => [r.note, r]));
    let payments = 0;
    let excessAmount = 0;
    let intentsWithExtra = 0;
    let paymentIdMismatch = 0;
    let firstAttemptCut = 0;
    let replayed = 0;
    const attemptsHistogram: Record<string, number> = {};
    // Số payment trong DB của mỗi ý định → số ý định; "không response" = mọi lần gửi đều không nhận được response.
    const paymentsPerIntent: Record<string, number> = {};
    let noResponse = 0;
    const finalStatus: Record<string, number> = {};
    for (const o of outcomes) {
      const r = byNote.get(o.note);
      const n = Number(r?.n ?? 0);
      payments += n;
      if (n > 1) intentsWithExtra++;
      paymentsPerIntent[n] = (paymentsPerIntent[n] ?? 0) + 1;
      if (!o.outcome) noResponse++;
      excessAmount += Number(r?.amount ?? 0) - (n > 0 ? o.amount : 0);
      const attempts = o.outcome?.attempts ?? [];
      if (attempts[0]?.error) firstAttemptCut++;
      attemptsHistogram[attempts.length] = (attemptsHistogram[attempts.length] ?? 0) + 1;
      const status = o.outcome ? String(o.outcome.status) : 'lỗi client';
      finalStatus[status] = (finalStatus[status] ?? 0) + 1;
      if (o.outcome?.replayed) replayed++;
      // Response cuối client nhận phải là payment có thật trong DB (với bản sau: đúng payment duy nhất).
      const returnedId = o.outcome ? (JSON.parse(o.outcome.body) as { paymentId?: string }).paymentId : undefined;
      if (!returnedId || !r?.ids.includes(returnedId)) paymentIdMismatch++;
    }
    const summary = {
      variant, intents: N, seconds, firstAttemptCut, attemptsHistogram, paymentsPerIntent, noResponse, finalStatus, replayed,
      payments, excessPayments: payments - N, intentsWithExtra, excessAmount, paymentIdMismatch,
      firstErrors: [...new Set(outcomes.flatMap((o) => o.outcome?.attempts.filter((a) => a.error).map((a) => a.error) ?? []))].slice(0, 5),
      clientFailures: outcomes.filter((o) => o.error).slice(0, 5),
    };
    console.log(JSON.stringify(summary));
    variants.push(summary);
  }
} finally {
  await cutResponses(false).catch(() => undefined);
  await api.stop();
  await db.destroy();
}
const gaps = sleep.stop();
const file = writeResult(`${OUT}.json`, { n: N, seed: SEED, tag: TAG, cutMode: CUT_MODE, timeoutMs: TIMEOUT_MS, ...env, after: machineState(), sleepGaps: gaps, variants });
console.log(`→ ${file}${gaps.length ? ` · CẢNH BÁO: máy ngủ ${gaps.length} lần, chạy lại lượt này` : ''}`);
