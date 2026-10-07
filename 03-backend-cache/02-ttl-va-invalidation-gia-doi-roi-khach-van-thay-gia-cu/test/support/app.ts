import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { InvalidationWorker } from '../../src/sau/invalidation.worker';
import { runPromoTick as sauPromoTick } from '../../src/sau/price-writers';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../src/shared/config';
import { createDb, KYSELY, type Database } from '../../src/shared/db';
import { cacheKeys, type Variant } from '../../src/shared/pages';
import { createRedis, REDIS } from '../../src/shared/redis.client';
import { runPromoTick as truocPromoTick } from '../../src/truoc/price-writers';

export const config = loadConfig();

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  redis: Redis;
  close: () => Promise<void>;
}

/** App NestJS đầy đủ (cả hai bản) trên PostgreSQL và Redis thật; ghi đè cấu hình (TTL ngắn, DB qua proxy, Redis chết). */
export async function startApp(overrides: Partial<AppConfig> & { dbPoolMax?: number } = {}): Promise<TestApp> {
  const cfg: AppConfig = { ...config, ...overrides, watchIds: [], watchLog: null };
  const db = createDb(cfg.databaseUrl, { max: overrides.dbPoolMax ?? 10 });
  const redis = createRedis(cfg.redisUrl, cfg.redisCommandTimeoutMs);
  if (cfg.redisUrl === config.redisUrl) await waitReady(redis);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(cfg)
    .overrideProvider(KYSELY)
    .useValue(db)
    .overrideProvider(REDIS)
    .useValue(redis)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  // Nghe sẵn một cổng ngẫu nhiên: supertest dùng luôn địa chỉ này thay vì listen lại cho mỗi request.
  await app.listen(0, '127.0.0.1');
  return { app, http: app.getHttpServer(), redis, close: () => app.close() };
}

export function waitReady(redis: Redis, timeoutMs = 5_000): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Redis chưa sẵn sàng sau ${timeoutMs} ms (status ${redis.status})`)), timeoutMs);
    redis.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Kết nối riêng của test để xem/xóa key, không đi qua app. */
export const inspectorRedis = () => new Redis(config.redisUrl);
/** Kysely riêng cho fixture và cho worker trong test. */
export const fixtureDb = (): Kysely<Database> => createDb(config.databaseUrl, { max: 4 });

export function worker(db: Kysely<Database>, redis: Redis, batchSize = 500): InvalidationWorker {
  return new InvalidationWorker(db, redis, { batchSize, pollMs: 500, unlinkChunk: 500 });
}

/** Một cổng TCP vừa được cấp rồi đóng lại: kết nối tới đó bị từ chối, giống Redis đã dừng. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

export interface Fixture {
  slug: string;
  /** Sản phẩm đầu tiên của danh mục, đồng thời nằm trong "deal hôm nay". */
  id: number;
  ids: number[];
  oldPrice: number;
  cleanup: () => Promise<void>;
}

/**
 * Một danh mục riêng của test (3 sản phẩm, trang 1 chứa cả ba) và sản phẩm đầu đưa lên đầu "deal hôm nay".
 * Xóa key trang chủ của cả hai bản để lần đọc sau nạp danh sách có sản phẩm này.
 */
export async function createFixture(db: Kysely<Database>, inspector: Redis): Promise<Fixture> {
  const slug = `test-${randomUUID().slice(0, 8)}`;
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const { id } = await db
      .insertInto('products')
      .values({ category: slug, name: `Sản phẩm test ${i}`, list_price: 100_000 * i, price: 100_000 * i })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(id);
  }
  const id = ids[0]!;
  await db.insertInto('home_deals').values({ position: -id, product_id: id }).execute();
  await inspector.del(cacheKeys.home('truoc'), cacheKeys.home('sau'));
  return {
    slug,
    id,
    ids,
    oldPrice: 100_000,
    cleanup: async () => {
      await db.deleteFrom('home_deals').where('product_id', 'in', ids).execute();
    },
  };
}

export type PagePrices = { product: number; category: number; home: number; sources: string[] };

/** Giá của sản phẩm f.id trên ba trang có chứa nó, đọc qua API của một bản. */
export async function pricesOn(http: TestApp['http'], variant: Variant, f: Fixture): Promise<PagePrices> {
  const [p, c, h] = await Promise.all([
    request(http).get(`/${variant}/products/${f.id}`).expect(200),
    request(http).get(`/${variant}/categories/${f.slug}?page=1`).expect(200),
    request(http).get(`/${variant}/home/deals`).expect(200),
  ]);
  const find = (items: { id: number; price: number }[]) => items.find((x) => x.id === f.id)?.price ?? NaN;
  return { product: p.body.price, category: find(c.body.items), home: find(h.body.items), sources: [p, c, h].map((r) => r.headers['x-cache'] as string) };
}

export const allEqual = (p: PagePrices, price: number) => p.product === price && p.category === price && p.home === price;

/** Gọi fn mỗi intervalMs tới khi trả giá trị truthy; trả kèm thời gian đã chờ. */
export async function waitUntil<T>(fn: () => Promise<T | false | null | undefined>, timeoutMs: number, intervalMs = 50): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  for (;;) {
    const value = await fn();
    if (value) return { value, ms: performance.now() - start };
    if (performance.now() - start > timeoutMs) throw new Error(`chưa đạt điều kiện sau ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Đường ghi 2: nạp dòng vào price_import rồi chạy đúng file SQL của job (giống psql -f, giao thức simple query). */
export async function runCsvImport(variant: Variant, rows: { productId: number; newPrice: number }[]): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    for (const r of rows) await client.query('INSERT INTO price_import (product_id, new_price) VALUES ($1, $2)', [r.productId, r.newPrice]);
    await client.query(readFileSync(`sql/${variant}/import-prices.sql`, 'utf8'));
  } finally {
    await client.end();
  }
}

/** Đường ghi 3: đặt lịch khuyến mãi đã tới giờ bắt đầu rồi cho job quét một lượt. */
export async function startPromotion(db: Kysely<Database>, variant: Variant, productId: number, promoPrice: number): Promise<void> {
  const now = Date.now();
  await db
    .insertInto('promotions')
    .values({ product_id: productId, promo_price: promoPrice, starts_at: new Date(now - 1_000), ends_at: new Date(now + 3_600_000) })
    .execute();
  await (variant === 'sau' ? sauPromoTick : truocPromoTick)(db, new Date());
}

export type WritePath = 'admin' | 'csv' | 'promo';

export async function changePrice(t: TestApp, db: Kysely<Database>, variant: Variant, path: WritePath, id: number, price: number): Promise<void> {
  if (path === 'admin') await request(t.http).patch(`/${variant}/admin/products/${id}/price`).send({ price }).expect(200);
  else if (path === 'csv') await runCsvImport(variant, [{ productId: id, newPrice: price }]);
  else await startPromotion(db, variant, id, price);
}

/** Số sự kiện chưa xử lý của các sản phẩm `ids`. */
export async function pendingEvents(db: Kysely<Database>, ids: number[]): Promise<number> {
  const row = await db.selectFrom('price_outbox').select((eb) => eb.fn.countAll<number>().as('n')).where('processed_at', 'is', null).where('product_id', 'in', ids).executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Xử lý hết sự kiện còn tồn (của test khác) để test bắt đầu từ outbox sạch. */
export async function drain(w: InvalidationWorker): Promise<number> {
  let n = 0;
  for (;;) {
    const r = await w.runOnce();
    if (!r.events) return n;
    n += r.events;
  }
}

/** Redis cho worker trong test (timeout 500 ms như pnpm worker), đã sẵn sàng nhận lệnh. */
export async function readyRedis(timeoutMs = 500): Promise<Redis> {
  const redis = createRedis(config.redisUrl, timeoutMs, 'test.redis');
  await waitReady(redis);
  return redis;
}

/** Redis "đã chết": cổng không ai nghe, mọi lệnh lỗi ngay. */
export const deadRedis = async (): Promise<Redis> => createRedis(`redis://127.0.0.1:${await closedPort()}`, 500, 'test.dead-redis');
