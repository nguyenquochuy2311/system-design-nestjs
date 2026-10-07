import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/shared/db';
import {
  allEqual,
  changePrice,
  closedPort,
  createFixture,
  deadRedis,
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

beforeAll(async () => {
  t = await startApp();
  db = fixtureDb();
  inspector = inspectorRedis();
  workerRedis = await readyRedis();
  await drain(worker(db, workerRedis));
});
afterAll(async () => {
  workerRedis.disconnect();
  await t.close();
  await db.destroy();
  inspector.disconnect();
});

describe('Xóa cache thất bại: sự kiện không mất, TTL giới hạn thời gian sai', () => {
  it('Redis không kết nối được lúc worker xóa: lô báo lỗi, sự kiện còn nguyên trong outbox; Redis có lại thì xử lý xong', async () => {
    const f = await createFixture(db, inspector);
    const dead = await deadRedis();
    try {
      await pricesOn(t.http, 'sau', f);
      await changePrice(t, db, 'sau', 'admin', f.id, 71_000);
      await expect(worker(db, dead).runOnce()).rejects.toThrow();
      expect(await pendingEvents(db, [f.id])).toBe(1);
      expect(allEqual(await pricesOn(t.http, 'sau', f), f.oldPrice)).toBe(true); // vẫn giá cũ, nhưng chưa mất gì

      expect((await worker(db, workerRedis).runOnce()).events).toBeGreaterThanOrEqual(1);
      expect(await pendingEvents(db, [f.id])).toBe(0);
      expect(allEqual(await pricesOn(t.http, 'sau', f), 71_000)).toBe(true);
    } finally {
      dead.disconnect();
      await f.cleanup();
    }
  });

  it('Redis treo lúc worker xóa (CLIENT PAUSE 1,5 s): lô hết giờ sau 500 ms, sự kiện không mất, lượt sau xử lý xong', async () => {
    const f = await createFixture(db, inspector);
    try {
      await pricesOn(t.http, 'sau', f);
      await changePrice(t, db, 'sau', 'admin', f.id, 72_000);
      await inspector.call('CLIENT', 'PAUSE', '1500', 'ALL');
      const started = performance.now();
      await expect(worker(db, workerRedis).runOnce()).rejects.toThrow(/timed out/i);
      expect(performance.now() - started).toBeLessThan(1_200);
      expect(await pendingEvents(db, [f.id])).toBe(1);
      await sleep(1_600); // hết pause
      expect((await worker(db, workerRedis).runOnce()).events).toBeGreaterThanOrEqual(1);
      expect(await pendingEvents(db, [f.id])).toBe(0);
      expect(allEqual(await pricesOn(t.http, 'sau', f), 72_000)).toBe(true);
    } finally {
      await sleep(100);
      await f.cleanup();
    }
  });

  it('lệnh xóa báo hết giờ chưa chắc đã không xóa: Redis treo xong vẫn chạy lệnh đã nhận, nên thao tác của worker phải idempotent', async () => {
    const key = `sau:test-timeout:${randomUUID()}`;
    await inspector.set(key, 'giá cũ', 'EX', 60);
    const client = await readyRedis(50);
    try {
      await inspector.call('CLIENT', 'PAUSE', '800', 'WRITE'); // lệnh ghi bị giữ, lệnh đọc vẫn chạy
      await expect(client.del(key)).rejects.toThrow(/timed out/i);
      expect(await inspector.exists(key)).toBe(1); // phía client đã báo lỗi, key vẫn còn
      await sleep(1_000);
      expect(await inspector.exists(key)).toBe(0); // hết treo: Redis chạy nốt lệnh DEL đã nằm trong socket
    } finally {
      client.disconnect();
    }
  });

  it('Redis chết đúng lúc sửa giá: bản trước mất lệnh xóa (giá cũ tới hết TTL), bản sau vẫn còn sự kiện để xóa sau', async () => {
    const f = await createFixture(db, inspector);
    const writer = await startApp({ redisUrl: `redis://127.0.0.1:${await closedPort()}` });
    try {
      await pricesOn(t.http, 'truoc', f);
      await pricesOn(t.http, 'sau', f);
      // Một instance API khác (Redis của nó không kết nối được) nhận lệnh sửa giá của admin: DB vẫn ghi, PATCH vẫn 200.
      await request(writer.http).patch(`/truoc/admin/products/${f.id}/price`).send({ price: 61_000 }).expect(200);
      const truoc = await pricesOn(t.http, 'truoc', f);
      expect(truoc.product).toBe(f.oldPrice); // lệnh DEL lỗi và không ai làm lại: kể cả trang chi tiết cũng giữ giá cũ
      expect(truoc.sources[0]).toBe('HIT');

      await request(writer.http).patch(`/sau/admin/products/${f.id}/price`).send({ price: 62_000 }).expect(200);
      expect(await pendingEvents(db, [f.id])).toBe(1); // đường ghi bản sau không gọi Redis: sự kiện đã nằm trong outbox
      await worker(db, workerRedis).runOnce();
      expect(allEqual(await pricesOn(t.http, 'sau', f), 62_000)).toBe(true);
    } finally {
      await writer.close();
      await f.cleanup();
    }
  });

  it('không có worker (sự kiện bị lỡ): giá cũ chỉ sống tới hết TTL rồi trang tự nạp giá mới (TTL 3 s ± 10 % trong test)', async () => {
    const short = await startApp({ pageTtlS: 3 });
    const f = await createFixture(db, inspector);
    try {
      await pricesOn(short.http, 'sau', f);
      const loadedAt = performance.now();
      await changePrice(short, db, 'sau', 'admin', f.id, 55_000);
      await db.deleteFrom('price_outbox').where('product_id', '=', f.id).execute(); // mất sự kiện do lỗi vận hành
      expect(allEqual(await pricesOn(short.http, 'sau', f), f.oldPrice)).toBe(true);
      await waitUntil(async () => allEqual(await pricesOn(short.http, 'sau', f), 55_000), 8_000, 100);
      // TTL lúc nạp tối đa ceil(3 × 1,1) = 4 giây: giá cũ không thể sống lâu hơn thế (cộng độ trễ của vòng poll).
      expect(performance.now() - loadedAt).toBeLessThan(4_000 + 500);
    } finally {
      await f.cleanup();
      await short.close();
    }
  });
});
