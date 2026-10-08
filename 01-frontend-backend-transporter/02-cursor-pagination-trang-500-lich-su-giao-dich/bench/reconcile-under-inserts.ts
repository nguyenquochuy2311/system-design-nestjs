/**
 * "Kế toán đối soát": lật 500 trang đầu lịch sử của một merchant qua API trong khi giao dịch mới vẫn đổ vào
 * (README mục 5, chỉ số "số bản ghi lặp khi có insert đồng thời"). Đếm dòng lặp và dòng cũ bị đẩy ra khỏi 500 trang.
 * Luồng ghi bắt đầu ngay sau trang 1, nên với keyset "đúng" nghĩa là: 0 lặp, đúng 10.000 dòng cũ đầu tiên.
 * Cuối mỗi lượt xóa các dòng vừa chèn để bảng seed giữ nguyên.
 * Chạy: RUN=main LABEL=rate20 MERCHANT=7 RATE=20 THINK_MS=20 pnpm bench:reconcile   (VARIANTS=offset,keyset PAGES=500)
 */
import { sql } from 'kysely';
import type { CursorPageResponse } from '../src/app.js';
import { createDb } from '../src/shared/db.js';
import type { OffsetPage } from '../src/truoc/transactions-offset.repository.js';
import { startApi } from './lib/api-process.js';
import { machineState, writeResult } from './lib/env.js';

const LABEL = process.env.LABEL ?? 'reconcile';
const MERCHANT = Number(process.env.MERCHANT ?? 7);
const RATE = Number(process.env.RATE ?? 20); // giao dịch mới mỗi giây cho merchant này; 0 = không chèn
const THINK_MS = Number(process.env.THINK_MS ?? 20); // thời gian "đọc" mỗi trang trước khi bấm trang sau
const PAGES = Number(process.env.PAGES ?? 500);
const VARIANTS = (process.env.VARIANTS ?? 'offset,keyset').split(',') as ('offset' | 'keyset')[];
const SIZE = 20;
const BASE = 'http://127.0.0.1:3100';

const db = createDb({ max: 2 });
const api = await startApi();
const results = [];

try {
  for (const variant of VARIANTS) {
    const maxIdBefore = (await sql<{ m: string }>`SELECT max(id) AS m FROM transactions`.execute(db)).rows[0]!.m;
    const snapshot = (
      await db.selectFrom('transactions').select('id').where('merchant_id', '=', MERCHANT)
        .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(PAGES * SIZE).execute()
    ).map((r) => r.id);

    let inserting = false; // bật sau trang 1
    let stop = false;
    let inserted = 0;
    const writer = (async () => {
      while (RATE > 0 && !stop) {
        if (inserting) {
          await db.insertInto('transactions')
            .values({ merchant_id: MERCHANT, amount: 99_000, kind: 'payment', description: 'Giao dịch mới trong lúc đối soát' })
            .execute();
          inserted += 1;
        }
        await new Promise((r) => setTimeout(r, 1000 / RATE));
      }
    })();

    const before = machineState();
    const t0 = Date.now();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 1; page <= PAGES; page++) {
      const url =
        variant === 'offset'
          ? `${BASE}/merchants/${MERCHANT}/transactions?page=${page}&size=${SIZE}`
          : `${BASE}/merchants/${MERCHANT}/transactions?limit=${SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${variant} trang ${page}: ${res.status}`);
      const body = (await res.json()) as CursorPageResponse | OffsetPage;
      seen.push(...body.items.map((t) => t.id));
      if ('nextCursor' in body) cursor = body.nextCursor;
      if (page === 1) inserting = true; // giao dịch mới bắt đầu đổ vào sau khi kế toán mở trang 1
      if (THINK_MS > 0) await new Promise((r) => setTimeout(r, THINK_MS));
    }
    const seconds = (Date.now() - t0) / 1000;
    stop = true;
    await writer;

    const counts = new Map<string, number>();
    for (const id of seen) counts.set(id, (counts.get(id) ?? 0) + 1);
    const duplicates = [...counts.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
    const seenSet = new Set(seen);
    const oldMissing = snapshot.filter((id) => !seenSet.has(id)).length;
    const newSeen = seen.filter((id) => BigInt(id) > BigInt(maxIdBefore)).length;
    const deleted = await db.deleteFrom('transactions').where('id', '>', maxIdBefore).executeTakeFirst();
    const r = { variant, merchant: MERCHANT, rate: RATE, thinkMs: THINK_MS, pages: PAGES, seconds, inserted, rowsSeen: seen.length, duplicates, oldMissing, newSeen, deletedAfter: Number(deleted.numDeletedRows), before, after: machineState() };
    results.push(r);
    console.log(`${variant.padEnd(6)} ${seconds.toFixed(1)} s · chèn ${inserted} · thấy ${seen.length} dòng · lặp ${duplicates} · dòng cũ ra khỏi 500 trang ${oldMissing} · dòng mới lọt vào ${newSeen}`);
  }
} finally {
  await api.stop();
  await sql`VACUUM (ANALYZE) transactions`.execute(db);
  await db.destroy();
}
console.log(`→ ${writeResult(`reconcile/${LABEL}.json`, { label: LABEL, results })}`);
