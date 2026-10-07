import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { AppModule } from '../../src/app.module';
import { loadConfig } from '../../src/shared/config';
import { createDb, KYSELY, type Database } from '../../src/shared/db';
import { createRedis, REDIS } from '../../src/shared/redis.client';

const config = loadConfig();

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  redis: Redis;
  /** Số câu SQL mà app (không tính fixture) đã chạy kể từ lần reset gần nhất. */
  queries: { count: () => number; reset: () => void };
  close: () => Promise<void>;
}

/** App NestJS đầy đủ (cả hai bản) trên PostgreSQL và Redis thật; `redisUrl` để trỏ Redis tới chỗ chết khi cần. */
export async function startApp(opts: { redisUrl?: string; redisCommandTimeoutMs?: number } = {}): Promise<TestApp> {
  let count = 0;
  const db = createDb(config.databaseUrl, { onQuery: () => count++ });
  const redis = createRedis(opts.redisUrl ?? config.redisUrl, opts.redisCommandTimeoutMs ?? config.redisCommandTimeoutMs);
  if (!opts.redisUrl) await waitReady(redis);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(KYSELY)
    .useValue(db)
    .overrideProvider(REDIS)
    .useValue(redis)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return {
    app,
    http: app.getHttpServer(),
    redis,
    queries: { count: () => count, reset: () => (count = 0) },
    close: () => app.close(),
  };
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
/** Kysely riêng cho fixture: câu SQL của fixture không lọt vào bộ đếm của app. */
export const fixtureDb = (): Kysely<Database> => createDb(config.databaseUrl, { max: 3 });

const TEST_SHOP_ID = 990_001;

/** Tạo một sản phẩm mới (id chưa từng có trong cache) với `variants` biến thể và 3 ảnh. */
export async function createProduct(db: Kysely<Database>, variants = 2): Promise<{ id: number; variantIds: number[] }> {
  await db.insertInto('shop_ratings').values({ shop_id: TEST_SHOP_ID, rating_avg: 4.5, rating_count: 10 }).onConflict((oc) => oc.doNothing()).execute();
  const { id } = await db
    .insertInto('products')
    .values({ shop_id: TEST_SHOP_ID, name: 'Sản phẩm test', description: 'Mô tả test', category: 'test' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const variantIds: number[] = [];
  for (let v = 1; v <= variants; v++) {
    const row = await db
      .insertInto('product_variants')
      .values({ product_id: id, sku: `TEST-${id}-${v}`, name: `Phân loại ${v}`, stock: 10 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.insertInto('variant_prices').values({ variant_id: row.id, price: 100_000 * v, list_price: 120_000 * v }).execute();
    variantIds.push(row.id);
  }
  await db
    .insertInto('product_images')
    .values([1, 2, 3].map((position) => ({ product_id: id, url: `https://cdn.test/p/${id}/${position}.jpg`, position })))
    .execute();
  return { id, variantIds };
}

/** id chắc chắn không tồn tại: lớn hơn mọi id đã cấp. */
export async function missingProductId(db: Kysely<Database>): Promise<number> {
  const { rows } = await sql<{ next: number }>`SELECT coalesce(max(id), 0) + 1000000 AS next FROM products`.execute(db);
  return Number(rows[0]!.next);
}
