/**
 * Ràng buộc mục 1: "giá trong JSON trang sản phẩm phải mới trong vòng 1 phút". Đổi giá trên máy gốc rồi hỏi qua CDN
 * mỗi 250 ms (như trình duyệt với max-age=0: luôn hỏi lại CDN) cho tới khi thấy giá mới; ghi số giây.
 * Mỗi lần thử đổi giá ở một thời điểm khác nhau trong chu kỳ 60 giây của bản lưu ở CDN (sau khi CDN lưu được OFFSETS giây).
 *   RUN=main pnpm bench:freshness    (MODE=sau OFFSETS=5,30,55)
 */
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { CacheMode } from '../src/shared/config';
import { ADMIN_TOKEN, CDN, rawGet } from '../test/support/lab';
import { collectCdnLog, resetCdn, resultsDir, startOrigins, writeJson } from './lib';

const mode = (process.env.MODE ?? 'sau') as CacheMode;
const offsets = (process.env.OFFSETS ?? '5,30,55').split(',').map(Number);
const dir = resultsDir();
const PRODUCT = 7;
const path = `/api/products/${PRODUCT}`;

async function setPrice(price: number) {
  const res = await fetch(`http://127.0.0.1:3100/api/admin/products/${PRODUCT}/price`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify({ price }),
  });
  if (!res.ok) throw new Error(`đổi giá lỗi ${res.status}`);
}

const origins = await startOrigins(mode, dir, `freshness-${mode}`, false);
const trials = [];
try {
  await resetCdn();
  let price = 5_000_000;
  for (const offset of offsets) {
    // CDN lưu bản mới (MISS hoặc lần hỏi lại sau khi hết hạn) rồi chờ offset giây
    let stored = await rawGet(`${CDN}${path}`);
    while (!['MISS', 'EXPIRED', 'REVALIDATED'].includes(stored.header('x-cache-status') ?? '') && mode === 'sau') {
      await sleep(250);
      stored = await rawGet(`${CDN}${path}`);
    }
    const storedAt = Date.now();
    await sleep(offset * 1000);
    price += 100_000;
    await setPrice(price);
    const changedAt = Date.now();
    const polls: { ms: number; price: number; cache: string | undefined }[] = [];
    for (;;) {
      const res = await rawGet(`${CDN}${path}`);
      const seen = (JSON.parse(res.text()) as { price: number }).price;
      polls.push({ ms: Date.now() - changedAt, price: seen, cache: res.header('x-cache-status') });
      if (seen === price) break;
      if (Date.now() - changedAt > 120_000) throw new Error('quá 120 giây vẫn chưa thấy giá mới');
      await sleep(250);
    }
    const staleMs = polls.at(-1)!.ms;
    trials.push({ offsetS: offset, changedAfterStoreMs: changedAt - storedAt, staleMs, polls: polls.length, lastCacheStatus: polls.at(-1)!.cache, cacheStatuses: [...new Set(polls.map((p) => p.cache))] });
    console.log(`${mode} đổi giá ${offset} s sau khi CDN lưu: thấy giá mới sau ${(staleMs / 1000).toFixed(1)} s (${polls.at(-1)!.cache})`);
  }
} finally {
  await origins.stop();
  await collectCdnLog(join(dir, `freshness-${mode}-cdn.log`));
}
writeJson(join(dir, `freshness-${mode}.json`), { mode, path, trials, maxStaleMs: Math.max(...trials.map((t) => t.staleMs)) });
