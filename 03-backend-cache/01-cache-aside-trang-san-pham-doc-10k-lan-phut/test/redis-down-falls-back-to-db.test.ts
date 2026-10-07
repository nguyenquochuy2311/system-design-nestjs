import { createServer } from 'node:net';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/shared/db';
import { createProduct, fixtureDb, inspectorRedis, startApp, waitReady } from './support/app';

let db: Kysely<Database>;
let inspector: Redis;

beforeAll(() => {
  db = fixtureDb();
  inspector = inspectorRedis();
});
afterAll(async () => {
  await db.destroy();
  inspector.disconnect();
});

/** Một cổng TCP vừa được cấp rồi đóng lại: kết nối tới đó bị từ chối, giống Redis đã dừng. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

const timed = async <T>(fn: () => Promise<T>) => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
};

describe('Redis lỗi thì trang sản phẩm chậm hơn chứ không sập', () => {
  it('Redis không kết nối được: trang vẫn trả 200 với đúng dữ liệu từ DB, không chờ kết nối lại', async () => {
    const { id } = await createProduct(db);
    const t = await startApp({ redisUrl: `redis://127.0.0.1:${await closedPort()}` });
    try {
      const expected = await request(t.http).get(`/truoc/products/${id}`).expect(200);
      for (let i = 0; i < 3; i++) {
        // Client hủy sau 2 giây như một load balancer; không có giới hạn này thì lỗi "treo" chỉ lộ ra khi hết thời gian của test.
        const { value: res, ms } = await timed(() => request(t.http).get(`/sau/products/${id}`).timeout(2_000));
        expect(ms).toBeLessThan(200); // lệnh lỗi ngay (enableOfflineQueue: false), không đứng chờ kết nối lại
        expect(res.status).toBe(200);
        expect(res.headers['x-cache']).toBe('BYPASS');
        expect(res.body).toEqual(expected.body);
      }
    } finally {
      await t.close();
    }
  });

  it('Redis treo (CLIENT PAUSE): request chờ khoảng 50 ms rồi trả 200 từ DB, không chờ thêm lần ghi cache', async () => {
    const { id } = await createProduct(db);
    const t = await startApp();
    try {
      await request(t.http).get(`/truoc/products/${id}`).expect(200); // khởi động nóng đường DB
      await inspector.call('CLIENT', 'PAUSE', '1500', 'ALL'); // Redis vẫn nhận kết nối nhưng không trả lời ai trong 1,5 giây
      const { value: res, ms } = await timed(() => request(t.http).get(`/sau/products/${id}`).timeout(2_000));
      expect(ms).toBeGreaterThanOrEqual(45);
      expect(ms).toBeLessThan(500); // không có commandTimeout thì request chờ tới khi hết pause (1,5 giây)
      expect(res.status).toBe(200);
      expect(res.headers['x-cache']).toBe('BYPASS');
      expect(res.body.id).toBe(id);
    } finally {
      await new Promise((r) => setTimeout(r, 1_600)); // chờ hết pause trước khi đóng app
      await t.close();
    }
  });

  it('Redis chết lúc sửa giá: giá vẫn được lưu và PATCH trả 200 (DB là nguồn sự thật)', async () => {
    const { id, variantIds } = await createProduct(db);
    const t = await startApp({ redisUrl: `redis://127.0.0.1:${await closedPort()}` });
    try {
      await request(t.http).patch(`/sau/products/${id}/price`).send({ variantId: variantIds[0], price: 55_000 }).timeout(2_000).expect(200);
      const res = await request(t.http).get(`/sau/products/${id}`).timeout(2_000).expect(200);
      expect(res.body.variants[0].price).toBe(55_000);
    } finally {
      await t.close();
    }
  });

  it('Redis rớt kết nối rồi có lại: cache được dùng lại mà không cần khởi động lại app', async () => {
    const { id } = await createProduct(db);
    const t = await startApp();
    try {
      await t.redis.client('SETNAME', 'catalog-test-reconnect');
      await request(t.http).get(`/sau/products/${id}`).expect(200);
      const reconnected = new Promise<void>((r) => t.redis.once('ready', () => r()));
      await inspector.call('CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes'); // cắt kết nối của app từ phía server
      const during = await request(t.http).get(`/sau/products/${id}`);
      expect(during.status).toBe(200);
      await reconnected;
      await waitReady(t.redis);
      const after = await request(t.http).get(`/sau/products/${id}`).expect(200);
      expect(after.headers['x-cache']).toBe('HIT');
    } finally {
      await t.close();
    }
  });
});
