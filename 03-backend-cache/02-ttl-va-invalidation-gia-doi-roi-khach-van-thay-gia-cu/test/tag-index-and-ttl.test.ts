import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaggedPageCache } from '../src/sau/tagged.cache';
import type { Database } from '../src/shared/db';
import { ShopMetrics } from '../src/shared/metrics';
import { cacheKeys } from '../src/shared/pages';
import { createFixture, fixtureDb, inspectorRedis, pricesOn, startApp, type TestApp } from './support/app';

let t: TestApp;
let db: Kysely<Database>;
let inspector: Redis;

beforeAll(async () => {
  t = await startApp();
  db = fixtureDb();
  inspector = inspectorRedis();
});
afterAll(async () => {
  await t.close();
  await db.destroy();
  inspector.disconnect();
});

describe('Chỉ mục ngược và TTL của bản sau', () => {
  it('nạp mỗi loại trang đều ghi key trang vào tag của mọi sản phẩm trong trang', async () => {
    const f = await createFixture(db, inspector);
    try {
      await pricesOn(t.http, 'sau', f);
      const productKey = cacheKeys.product('sau', f.id);
      const categoryKey = cacheKeys.category('sau', f.slug, 1);
      const homeKey = cacheKeys.home('sau');
      expect((await inspector.smembers(cacheKeys.tag('sau', f.id))).sort()).toEqual([categoryKey, homeKey, productKey].sort());
      // Sản phẩm thứ hai chỉ nằm trong trang danh mục (chưa ai xem trang chi tiết của nó).
      expect(await inspector.smembers(cacheKeys.tag('sau', f.ids[1]!))).toEqual([categoryKey]);
      // Bản trước không ghi chỉ mục nào.
      await pricesOn(t.http, 'truoc', f);
      expect(await inspector.exists(cacheKeys.tag('truoc', f.id))).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it('TTL trang nằm trong 810–990 s (15 phút ± 10 %), tag sống lâu hơn mọi key nó trỏ tới', async () => {
    const f = await createFixture(db, inspector);
    try {
      await pricesOn(t.http, 'sau', f);
      for (const key of [cacheKeys.product('sau', f.id), cacheKeys.category('sau', f.slug, 1), cacheKeys.home('sau')]) {
        const ttl = await inspector.ttl(key);
        expect(ttl).toBeGreaterThanOrEqual(809);
        expect(ttl).toBeLessThanOrEqual(990);
      }
      expect(await inspector.ttl(cacheKeys.tag('sau', f.id))).toBeGreaterThan(990);
    } finally {
      await f.cleanup();
    }
  });

  it('jitter: 30 key nạp cùng lúc có TTL khác nhau, không cùng hết hạn một giây', async () => {
    const cache = new TaggedPageCache(inspector, 900, 10, new ShopMetrics());
    const prefix = `sau:test-jitter:${randomUUID()}`;
    const ttls: number[] = [];
    for (let i = 0; i < 30; i++) {
      await cache.set(`${prefix}:${i}`, { i }, []);
      ttls.push(await inspector.ttl(`${prefix}:${i}`));
    }
    await inspector.del(...ttls.map((_, i) => `${prefix}:${i}`));
    expect(Math.min(...ttls)).toBeGreaterThanOrEqual(809);
    expect(Math.max(...ttls)).toBeLessThanOrEqual(990);
    expect(new Set(ttls).size).toBeGreaterThan(10); // không có jitter thì cả 30 key cùng TTL 900
  });
});
