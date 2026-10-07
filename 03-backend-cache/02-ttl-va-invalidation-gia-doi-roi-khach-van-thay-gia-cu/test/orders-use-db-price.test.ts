import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPromoTick as sauPromoTick } from '../src/sau/price-writers';
import type { Database } from '../src/shared/db';
import { runPromoTick as truocPromoTick } from '../src/truoc/price-writers';
import { createFixture, fixtureDb, inspectorRedis, startApp, startPromotion, type TestApp } from './support/app';

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

/** Khuyến mãi đang chạy rồi hết hạn: job quét lịch trả giá về niêm yết. */
async function endPromotions(variant: 'truoc' | 'sau', productId: number) {
  await db.updateTable('promotions').set({ ends_at: new Date(Date.now() - 1_000) }).where('product_id', '=', productId).where('state', '=', 'active').execute();
  await (variant === 'sau' ? sauPromoTick : truocPromoTick)(db, new Date());
}

describe('Bước đặt hàng và giá đã hết hiệu lực', () => {
  it('bản trước: hết khuyến mãi nhưng trang chi tiết còn cache giá khuyến mãi, đơn bị tính giá đã hết hiệu lực', async () => {
    const f = await createFixture(db, inspector);
    try {
      await startPromotion(db, 'truoc', f.id, 49_000);
      expect((await request(t.http).get(`/truoc/products/${f.id}`).expect(200)).body.price).toBe(49_000); // khách thấy giá KM
      await endPromotions('truoc', f.id);
      const order = await request(t.http).post('/truoc/orders').send({ productId: f.id }).expect(201);
      expect(order.body.chargedPrice).toBe(49_000);
      const row = await db.selectFrom('orders').selectAll().where('id', '=', order.body.id).executeTakeFirstOrThrow();
      expect(row.db_price).toBe(f.oldPrice); // lúc tạo đơn giá đúng đã là giá niêm yết
    } finally {
      await f.cleanup();
    }
  });

  it('bản sau: bước đặt hàng tính lại giá từ DB, đơn đúng giá kể cả khi cache còn giá cũ (worker chưa chạy)', async () => {
    const f = await createFixture(db, inspector);
    try {
      await startPromotion(db, 'sau', f.id, 49_000);
      expect((await request(t.http).get(`/sau/products/${f.id}`).expect(200)).body.price).toBe(49_000);
      await endPromotions('sau', f.id);
      expect((await request(t.http).get(`/sau/products/${f.id}`).expect(200)).body.price).toBe(49_000); // cache còn cũ
      const order = await request(t.http).post('/sau/orders').send({ productId: f.id }).expect(201);
      expect(order.body.chargedPrice).toBe(f.oldPrice);
      const row = await db.selectFrom('orders').selectAll().where('id', '=', order.body.id).executeTakeFirstOrThrow();
      expect(row.charged_price).toBe(row.db_price);
    } finally {
      await f.cleanup();
    }
  });
});
