import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('Cache-Aside: lần đọc thứ hai không chạm DB', () => {
  it('bản trước: hai lần xem cùng một sản phẩm chạy hai lần câu join 5 bảng', async () => {
    const { id } = await createProduct(db);
    t.queries.reset();
    await request(t.http).get(`/truoc/products/${id}`).expect(200);
    await request(t.http).get(`/truoc/products/${id}`).expect(200);
    expect(t.queries.count()).toBe(2);
  });

  it('bản sau: lần đọc đầu trượt cache, đọc DB một lần rồi nạp key product:v1:<id> với TTL 600–660 giây', async () => {
    const { id } = await createProduct(db);
    t.queries.reset();
    const res = await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(t.queries.count()).toBe(1);
    expect(JSON.parse((await inspector.get(`product:v1:${id}`))!)).toEqual(res.body);
    const ttl = await inspector.ttl(`product:v1:${id}`);
    expect(ttl).toBeGreaterThanOrEqual(599); // 600 + jitter 0–60, trừ tối đa 1 giây đã trôi
    expect(ttl).toBeLessThanOrEqual(660);
  });

  it('bản sau: lần đọc thứ hai trúng cache, không chạm DB và trả đúng JSON của lần đầu', async () => {
    const { id } = await createProduct(db);
    const first = await request(t.http).get(`/sau/products/${id}`).expect(200);
    t.queries.reset();
    const second = await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(t.queries.count()).toBe(0);
    expect(second.body).toEqual(first.body);
  });

  it('100 lượt xem một sản phẩm nóng ở bản sau chỉ chạm DB một lần', async () => {
    const { id } = await createProduct(db);
    t.queries.reset();
    for (let i = 0; i < 100; i++) await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(t.queries.count()).toBe(1);
  });

  it('hai bản trả cùng JSON (không đổi hợp đồng API), bản sau chỉ thêm header X-Cache', async () => {
    const { id } = await createProduct(db, 3);
    const before = await request(t.http).get(`/truoc/products/${id}`).expect(200);
    const missed = await request(t.http).get(`/sau/products/${id}`).expect(200);
    const hit = await request(t.http).get(`/sau/products/${id}`).expect(200);
    expect(missed.body).toEqual(before.body);
    expect(hit.body).toEqual(before.body);
    expect(before.body.variants).toHaveLength(3);
    expect(before.body.images).toHaveLength(3);
    expect(before.headers['x-cache']).toBeUndefined();
  });
});
