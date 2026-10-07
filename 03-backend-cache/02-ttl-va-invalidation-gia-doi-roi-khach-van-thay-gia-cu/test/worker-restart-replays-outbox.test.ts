import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvalidationWorker } from '../src/sau/invalidation.worker';
import type { Database } from '../src/shared/db';
import {
  allEqual,
  changePrice,
  createFixture,
  drain,
  fixtureDb,
  inspectorRedis,
  pendingEvents,
  pricesOn,
  readyRedis,
  sleep,
  startApp,
  waitUntil,
  worker,
  type TestApp,
} from './support/app';

let t: TestApp;
let db: Kysely<Database>;
let inspector: Redis;
let workerRedis: Redis;
let w: InvalidationWorker;

beforeAll(async () => {
  t = await startApp();
  db = fixtureDb();
  inspector = inspectorRedis();
  workerRedis = await readyRedis();
  w = worker(db, workerRedis);
  await drain(w);
});
afterAll(async () => {
  await w.stop();
  workerRedis.disconnect();
  await t.close();
  await db.destroy();
  inspector.disconnect();
});

describe('Outbox giữ sự kiện khi worker chết; xử lý lại không hại', () => {
  it('worker dừng: sự kiện của cả ba đường ghi nằm lại trong outbox, khách còn thấy giá cũ; worker chạy lại thì giá mới hiện ra', async () => {
    const fs = [await createFixture(db, inspector), await createFixture(db, inspector), await createFixture(db, inspector)];
    try {
      for (const f of fs) await pricesOn(t.http, 'sau', f);
      await changePrice(t, db, 'sau', 'admin', fs[0]!.id, 81_000);
      await changePrice(t, db, 'sau', 'csv', fs[1]!.id, 82_000);
      await changePrice(t, db, 'sau', 'promo', fs[2]!.id, 83_000);
      await sleep(1_500);
      expect(await pendingEvents(db, fs.map((f) => f.id))).toBe(3);
      for (const f of fs) expect(allEqual(await pricesOn(t.http, 'sau', f), f.oldPrice)).toBe(true);

      w.start(); // "khởi động lại" worker: đọc tiếp từ outbox, không cần ai phát lại sự kiện
      const { ms } = await waitUntil(async () => {
        const seen = await Promise.all(fs.map((f) => pricesOn(t.http, 'sau', f)));
        return allEqual(seen[0]!, 81_000) && allEqual(seen[1]!, 82_000) && allEqual(seen[2]!, 83_000);
      }, 5_000);
      expect(ms).toBeLessThan(5_000);
      expect(await pendingEvents(db, fs.map((f) => f.id))).toBe(0);
    } finally {
      await w.stop();
      for (const f of fs) await f.cleanup();
    }
  });

  it('worker chết sau khi xóa key nhưng trước khi đánh dấu đã xử lý: lượt sau xóa lại, không lỗi, giá vẫn đúng', async () => {
    const f = await createFixture(db, inspector);
    try {
      await pricesOn(t.http, 'sau', f);
      await changePrice(t, db, 'sau', 'admin', f.id, 91_000);
      expect((await w.runOnce()).events).toBeGreaterThanOrEqual(1);
      expect(allEqual(await pricesOn(t.http, 'sau', f), 91_000)).toBe(true); // nạp lại cả ba trang với giá mới
      // Chết trước COMMIT nghĩa là transaction rollback: processed_at vẫn NULL, sự kiện sẽ được xử lý lại.
      await db.updateTable('price_outbox').set({ processed_at: null }).where('product_id', '=', f.id).execute();
      const again = await w.runOnce();
      expect(again.events).toBeGreaterThanOrEqual(1);
      expect(again.keysRemoved).toBeGreaterThanOrEqual(3); // xóa lại bản (đã đúng) vừa nạp: chỉ tốn thêm một lần trượt
      expect(allEqual(await pricesOn(t.http, 'sau', f), 91_000)).toBe(true);
      expect(await pendingEvents(db, [f.id])).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it('hai worker chạy song song (SKIP LOCKED) chia nhau 300 sự kiện, không sự kiện nào bị xử lý hai lần', async () => {
    await drain(w);
    const base = 2_000_000_000 + Math.floor(Math.random() * 100_000_000); // id giả: worker không cần sản phẩm tồn tại
    await db.insertInto('price_outbox').values(Array.from({ length: 300 }, (_, i) => ({ product_id: base + i, source: 'admin' as const }))).execute();
    const r2 = await readyRedis();
    try {
      const w1 = worker(db, workerRedis, 20);
      const w2 = worker(db, r2, 20);
      const [n1, n2] = await Promise.all([drain(w1), drain(w2)]);
      expect(n1 + n2).toBe(300);
      expect(n1).toBeGreaterThan(0);
      expect(n2).toBeGreaterThan(0);
      expect(await pendingEvents(db, Array.from({ length: 300 }, (_, i) => base + i))).toBe(0);
    } finally {
      r2.disconnect();
    }
  });
});
