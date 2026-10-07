import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSetPrice } from '../src/sau/price-writers';
import type { Database } from '../src/shared/db';
import { cacheKeys } from '../src/shared/pages';
import { startDbProxy } from './support/db-proxy';
import { createFixture, drain, fixtureDb, inspectorRedis, readyRedis, sleep, startApp, waitUntil, worker } from './support/app';

let db: Kysely<Database>;
let inspector: Redis;
let workerRedis: Redis;

beforeAll(async () => {
  db = fixtureDb();
  inspector = inspectorRedis();
  workerRedis = await readyRedis();
  await drain(worker(db, workerRedis));
});
afterAll(async () => {
  workerRedis.disconnect();
  await db.destroy();
  inspector.disconnect();
});

describe('Đọc chen giữa lúc đổi giá (stale set, Nishtala et al. 2013)', () => {
  it('lượt đọc lấy giá cũ từ DB, worker xóa key, rồi lượt đọc mới ghi giá cũ vào cache: giá cũ chỉ sống tới hết TTL, không vĩnh viễn', async () => {
    const proxy = await startDbProxy(55432);
    // App đọc DB qua proxy, pool 1 kết nối, TTL 3 s ± 10 % để thấy lưới an toàn trong thời gian test.
    const app = await startApp({ databaseUrl: proxy.url, dbPoolMax: 1, pageTtlS: 3 });
    const f = await createFixture(db, inspector);
    const key = cacheKeys.category('sau', f.slug, 2);
    try {
      // Danh mục có 3 sản phẩm; trang 2 rỗng. Gọi trước một lần để kết nối qua proxy đã mở sẵn (không giữ lại bắt tay).
      await request(app.http).get(`/sau/categories/${f.slug}?page=2`).expect(200);
      await inspector.del(key);
      const page1 = cacheKeys.category('sau', f.slug, 1);
      await inspector.del(page1);

      // 1. Khách A đọc trang 1: trượt cache, câu SELECT chạy (snapshot giá cũ) nhưng kết quả bị giữ ở proxy.
      proxy.hold();
      const reading = request(app.http).get(`/sau/categories/${f.slug}?page=1`).then((r) => r);
      await waitUntil(async () => proxy.heldBytes() > 0, 3_000, 5);

      // 2. Admin đổi giá (commit) và worker xử lý sự kiện ngay: lúc này chưa có key nào để xóa.
      await adminSetPrice(db, f.id, 66_000);
      const batch = await worker(db, workerRedis).runOnce();
      expect(batch.events).toBeGreaterThanOrEqual(1);

      // 3. Kết quả cũ tới tay A; A ghi trang mang giá cũ vào cache, SAU lần xóa.
      proxy.release();
      const during = await reading;
      expect(during.headers['x-cache']).toBe('MISS');
      expect(during.body.items[0].price).toBe(f.oldPrice);

      const stale = await request(app.http).get(`/sau/categories/${f.slug}?page=1`).expect(200);
      expect(stale.headers['x-cache']).toBe('HIT');
      expect(stale.body.items[0].price).toBe(f.oldPrice); // cache dính giá cũ dù sự kiện đã xử lý xong
      const ttl = await inspector.ttl(page1);
      expect(ttl).toBeGreaterThan(0); // nhưng có hạn
      expect(ttl).toBeLessThanOrEqual(4);

      // 4. Không có sự kiện nào nữa; TTL tự gỡ bản cũ.
      await sleep(ttl * 1_000 + 200);
      const after = await request(app.http).get(`/sau/categories/${f.slug}?page=1`).expect(200);
      expect(after.headers['x-cache']).toBe('MISS');
      expect(after.body.items[0].price).toBe(66_000);
    } finally {
      proxy.release();
      await f.cleanup();
      await app.close();
      await proxy.close();
    }
  });
});
