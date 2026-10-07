import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InvalidationWorker } from '../src/sau/invalidation.worker';
import type { Database } from '../src/shared/db';
import { cacheKeys } from '../src/shared/pages';
import {
  allEqual,
  changePrice,
  createFixture,
  drain,
  fixtureDb,
  inspectorRedis,
  pricesOn,
  readyRedis,
  sleep,
  startApp,
  waitUntil,
  worker,
  type Fixture,
  type TestApp,
  type WritePath,
} from './support/app';

let t: TestApp;
let db: Kysely<Database>;
let inspector: Redis;
let fixtures: Fixture[] = [];

beforeAll(async () => {
  t = await startApp();
  db = fixtureDb();
  inspector = inspectorRedis();
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.cleanup();
});
afterAll(async () => {
  await t.close();
  await db.destroy();
  inspector.disconnect();
});

async function fixture(): Promise<Fixture> {
  const f = await createFixture(db, inspector);
  fixtures.push(f);
  return f;
}

const NEW_PRICE: Record<WritePath, number> = { admin: 89_000, csv: 107_000, promo: 50_000 };

describe('bản trước: chỉ có TTL 15 phút, chỉ màn hình admin xóa một key', () => {
  it('admin sửa giá: trang chi tiết có giá mới, nhưng trang danh mục và deal trang chủ vẫn giá cũ', async () => {
    const f = await fixture();
    expect(allEqual(await pricesOn(t.http, 'truoc', f), f.oldPrice)).toBe(true); // nạp cả ba trang vào cache
    await changePrice(t, db, 'truoc', 'admin', f.id, NEW_PRICE.admin);
    await sleep(1_000);
    const after = await pricesOn(t.http, 'truoc', f);
    expect(after.product).toBe(NEW_PRICE.admin);
    expect(after.category).toBe(f.oldPrice);
    expect(after.home).toBe(f.oldPrice);
    expect(after.sources).toEqual(['MISS', 'HIT', 'HIT']);
  });

  it.each(['csv', 'promo'] as const)('%s ghi thẳng PostgreSQL: cả ba trang vẫn giá cũ, key còn sống gần đủ 15 phút', async (path) => {
    const f = await fixture();
    await pricesOn(t.http, 'truoc', f);
    await changePrice(t, db, 'truoc', path, f.id, NEW_PRICE[path]);
    await sleep(1_000);
    const after = await pricesOn(t.http, 'truoc', f);
    expect(allEqual(after, f.oldPrice)).toBe(true);
    expect(after.sources).toEqual(['HIT', 'HIT', 'HIT']);
    expect((await db.selectFrom('products').select('price').where('id', '=', f.id).executeTakeFirstOrThrow()).price).toBe(NEW_PRICE[path]);
    const ttl = await inspector.ttl(cacheKeys.category('truoc', f.slug, 1));
    expect(ttl).toBeGreaterThan(890); // TTL cố định 900 s, không jitter: giá cũ còn gần 15 phút nữa
    expect(ttl).toBeLessThanOrEqual(900);
  });
});

describe('bản sau: mọi đường ghi sinh sự kiện, worker xóa mọi key chứa sản phẩm', () => {
  let w: InvalidationWorker;
  let workerRedis: Redis;
  beforeAll(async () => {
    workerRedis = await readyRedis();
    w = worker(db, workerRedis);
    await drain(w);
    w.start(); // chu kỳ 500 ms như tiến trình pnpm worker
  });
  afterAll(async () => {
    await w.stop();
    workerRedis.disconnect();
  });

  it.each(['admin', 'csv', 'promo'] as const)('%s: trang chi tiết, danh mục và deal trang chủ đều có giá mới trong vòng 5 giây', async (path) => {
    const f = await fixture();
    await pricesOn(t.http, 'sau', f);
    const warm = await pricesOn(t.http, 'sau', f);
    expect(warm.sources).toEqual(['HIT', 'HIT', 'HIT']); // cả ba trang đang được cache với giá cũ
    await changePrice(t, db, 'sau', path, f.id, NEW_PRICE[path]);
    const { ms } = await waitUntil(async () => allEqual(await pricesOn(t.http, 'sau', f), NEW_PRICE[path]), 5_000);
    expect(ms).toBeLessThan(5_000);
    const event = await db.selectFrom('price_outbox').selectAll().where('product_id', '=', f.id).executeTakeFirstOrThrow();
    expect(event.source).toBe(path);
    expect(event.processed_at).not.toBeNull();
    expect(event.keys_targeted).toBe(3); // chi tiết + danh mục + trang chủ
  });

  it('đổi giá sản phẩm thứ hai của danh mục cũng làm mới trang danh mục: chỉ mục ghi cho mọi sản phẩm trong trang', async () => {
    const f = await fixture();
    await request(t.http).get(`/sau/categories/${f.slug}`).expect(200);
    expect((await request(t.http).get(`/sau/categories/${f.slug}`).expect(200)).headers['x-cache']).toBe('HIT');
    await changePrice(t, db, 'sau', 'admin', f.ids[1]!, 199_000);
    const { value } = await waitUntil(async () => {
      const res = await request(t.http).get(`/sau/categories/${f.slug}`).expect(200);
      return res.body.items[1].price === 199_000 && (res.body.items as { price: number }[]);
    }, 5_000);
    expect(value.map((x) => x.price)).toEqual([100_000, 199_000, 300_000]);
  });
});
