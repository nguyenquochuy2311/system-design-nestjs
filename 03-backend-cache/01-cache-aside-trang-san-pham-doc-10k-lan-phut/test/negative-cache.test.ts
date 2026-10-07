import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/shared/db';
import { fixtureDb, inspectorRedis, missingProductId, startApp, type TestApp } from './support/app';

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

describe('Negative cache: id không tồn tại', () => {
  it('bản trước: bot quét 5 lần một id rỗng là 5 lần truy vấn DB', async () => {
    const id = await missingProductId(db);
    t.queries.reset();
    for (let i = 0; i < 5; i++) await request(t.http).get(`/truoc/products/${id}`).expect(404);
    expect(t.queries.count()).toBe(5);
  });

  it('bản sau: 5 lần xem id không tồn tại chỉ truy vấn DB một lần, dấu "không tồn tại" sống tối đa 30 giây', async () => {
    const id = (await missingProductId(db)) + 1;
    await inspector.del(`product:v1:${id}`); // lần chạy test trước trong vòng 30 giây có thể đã để lại dấu
    t.queries.reset();
    const first = await request(t.http).get(`/sau/products/${id}`).expect(404);
    expect(first.headers['x-cache']).toBe('MISS');
    for (let i = 0; i < 4; i++) {
      const res = await request(t.http).get(`/sau/products/${id}`).expect(404);
      expect(res.headers['x-cache']).toBe('NEGATIVE-HIT');
      expect(res.body).toEqual(first.body);
    }
    expect(t.queries.count()).toBe(1);
    const ttl = await inspector.ttl(`product:v1:${id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('id sai định dạng bị chặn ở controller, không chạm Redis hay DB', async () => {
    t.queries.reset();
    await request(t.http).get('/sau/products/abc').expect(400);
    await request(t.http).get('/sau/products/99999999999').expect(400);
    expect(t.queries.count()).toBe(0);
  });
});
