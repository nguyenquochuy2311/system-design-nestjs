import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/shared/config';
import type { Database } from '../src/shared/db';
import { createProduct, fixtureDb, inspectorRedis, startApp, type TestApp } from './support/app';

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

/** Chờ tới khi có một câu UPDATE products đang đứng chờ khóa dòng (transaction sửa giá đã đi được nửa đường). */
async function waitForBlockedUpdate(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query ILIKE 'update "products"%'`.execute(db);
    if ((rows[0]?.n ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error('transaction sửa giá không đứng chờ khóa như dự tính');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Ghi DB rồi xóa key: sửa giá xong khách thấy giá mới', () => {
  it.each(['truoc', 'sau'])('bản %s: sửa giá xong, lần đọc kế tiếp thấy giá mới', async (variant) => {
    const { id, variantIds } = await createProduct(db);
    const before = await request(t.http).get(`/${variant}/products/${id}`).expect(200);
    expect(before.body.variants[0].price).toBe(100_000);
    await request(t.http).patch(`/${variant}/products/${id}/price`).send({ variantId: variantIds[0], price: 89_000 }).expect(200);
    const after = await request(t.http).get(`/${variant}/products/${id}`).expect(200);
    expect(after.body.variants[0].price).toBe(89_000);
    expect(after.body.variants[1].price).toBe(200_000);
  });

  it('bản sau: PATCH thành công thì key đã bị xóa, lần đọc sau nạp lại từ DB', async () => {
    const { id, variantIds } = await createProduct(db);
    await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(await inspector.exists(`product:v1:${id}`)).toBe(1);
    await request(t.http).patch(`/sau/products/${id}/price`).send({ variantId: variantIds[1], price: 150_000 }).expect(200);
    expect(await inspector.exists(`product:v1:${id}`)).toBe(0);
    t.queries.reset();
    const res = await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(t.queries.count()).toBe(1);
  });

  it('bản sau: khách đọc đúng lúc transaction sửa giá chưa commit, sau commit cache không còn giữ giá cũ', async () => {
    const { id, variantIds } = await createProduct(db);
    // Giữ khóa dòng products của sản phẩm: transaction sửa giá cập nhật variant_prices xong sẽ đứng chờ ở UPDATE products.
    const locker = new pg.Client({ connectionString: loadConfig().databaseUrl });
    await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id]);
      const patching = request(t.http).patch(`/sau/products/${id}/price`).send({ variantId: variantIds[0], price: 77_000 }).then((r) => r);
      await waitForBlockedUpdate();

      // Lúc này giá mới chưa commit: khách đọc trượt cache, thấy giá cũ từ DB và nạp giá cũ vào cache.
      const during = await request(t.http).get(`/sau/products/${id}`).expect(200);
      expect(during.headers['x-cache']).toBe('MISS');
      expect(during.body.variants[0].price).toBe(100_000);

      await locker.query('COMMIT');
      expect((await patching).status).toBe(200);
    } finally {
      await locker.end();
    }
    // Xóa key sau commit gỡ bản cũ vừa được nạp; xóa trước khi ghi thì bản cũ này nằm lại tới hết TTL.
    const after = await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(after.body.variants[0].price).toBe(77_000);
  });

  it('bản sau: sửa giá thất bại (biến thể không thuộc sản phẩm) thì DB và cache giữ nguyên', async () => {
    const a = await createProduct(db);
    const b = await createProduct(db);
    await request(t.http).get(`/sau/products/${a.id}`).expect(200);
    await request(t.http).patch(`/sau/products/${a.id}/price`).send({ variantId: b.variantIds[0], price: 1_000 }).expect(404);
    const res = await request(t.http).get(`/sau/products/${a.id}`).expect(200);
    expect(res.headers['x-cache']).toBe('HIT');
    const other = await request(t.http).get(`/truoc/products/${b.id}`).expect(200);
    expect(other.body.variants[0].price).toBe(100_000);
  });
});
