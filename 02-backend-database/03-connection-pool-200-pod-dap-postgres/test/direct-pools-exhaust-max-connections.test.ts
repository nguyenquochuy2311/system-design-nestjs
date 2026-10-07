import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { classifyDbError } from '../src/shared/db-errors';
import { createDirectPool } from '../src/truoc/db-pool';
import {
  adminClient,
  appConnections,
  connectionLimit,
  createWallets,
  fillToLimit,
  resetPgBouncers,
  sampleWhile,
  settle,
  waitForAppConnections,
} from './helpers';

let admin: pg.Client;
let limit: number;

// Hai thông báo PostgreSQL dùng khi hết chỗ, cùng SQLSTATE 53300 (too_many_connections):
// - hết hẳn slot tiến trình: "sorry, too many clients already";
// - chỉ còn slot dành cho superuser: "remaining connection slots are reserved for roles with the SUPERUSER attribute".
const REJECTED_MESSAGES = ['sorry, too many clients already', 'remaining connection slots are reserved for roles with the SUPERUSER attribute'];

beforeAll(async () => {
  admin = await adminClient();
  await resetPgBouncers(); // PgBouncer giữ kết nối thật rảnh từ test khác: đóng hết để đếm cho sạch
  limit = await connectionLimit(admin);
});
afterAll(() => admin.end());

describe('trước: mỗi pod nối thẳng PostgreSQL với pool 20', () => {
  it('6 pod × 20 truy vấn đồng thời: DB nhận tối đa tới trần, phần còn lại bị từ chối 53300 và kết nối đã mở vẫn giữ khi rảnh', async () => {
    const { rows } = await admin.query("SELECT current_setting('max_connections') AS max, current_setting('superuser_reserved_connections') AS reserved");
    expect(rows[0]).toEqual({ max: '100', reserved: '3' });
    expect(limit).toBe(96); // 100 - 3 chỗ superuser - 1 kết nối superuser của chính test đang đo
    const baseline = (await appConnections(admin)).total;
    const pods = Array.from({ length: 6 }, (_, i) => createDirectPool(i));
    try {
      const attempts = pods.flatMap((pool) => Array.from({ length: 20 }, () => settle(pool.query('SELECT pg_sleep(1)'))));
      const { result, peak } = await sampleWhile(admin, Promise.all(attempts));

      const ok = result.filter((r) => r.ok);
      const rejected = result.filter((r) => !r.ok);
      // 120 kết nối đòi vào, chỉ có 96 chỗ. Khi ập vào cùng lúc, backend đang bị từ chối cũng tạm giữ một chỗ,
      // nên DB có thể từ chối sớm vài kết nối trước khi đủ trần.
      expect(ok.length + rejected.length).toBe(120);
      expect(rejected.length).toBeGreaterThanOrEqual(120 - (limit - baseline));
      expect(peak).toBeLessThanOrEqual(limit);
      expect(peak).toBeGreaterThanOrEqual(limit - 10);
      expect(peak).toBe(baseline + ok.length);
      for (const r of rejected) {
        const err = (r as { error: Error }).error;
        expect(classifyDbError(err)).toBe('db_too_many_clients');
        expect(REJECTED_MESSAGES).toContain(err.message);
      }

      // Truy vấn xong, nhưng kết nối vẫn mở ở trạng thái rảnh (idleTimeoutMillis 10 s) và vẫn chiếm chỗ.
      const after = await appConnections(admin);
      expect(after.total).toBe(baseline + ok.length);
      expect(after.idle).toBe(ok.length);
    } finally {
      await Promise.all(pods.map((p) => p.end()));
    }
  });

  it('DB đầy kết nối rảnh của các pod đang chạy: pod mới không qua được kiểm tra khởi động, API trả 503 db_too_many_clients', async () => {
    const [from, to] = await createWallets(admin, 2);
    expect(await waitForAppConnections(admin, 0)).toBe(0);
    const running = createDirectPool(90, limit + 5); // đại diện cho kết nối rảnh của các pod đang chạy
    const held = await fillToLimit(running);
    const newPod = createDirectPool(91);
    const app = buildApp(newPod, { podName: 'pod-91' });
    try {
      expect((await appConnections(admin)).total).toBe(limit);

      // Pod mới (autoscale vừa thêm) kiểm tra DB lúc khởi động: thất bại, sẽ thoát và được khởi động lại.
      const readiness = await settle(newPod.query('SELECT 1'));
      expect(readiness.ok).toBe(false);
      expect(classifyDbError((readiness as { error: unknown }).error)).toBe('db_too_many_clients');

      const res = await app.inject({
        method: 'POST',
        url: '/transfers',
        payload: { fromWalletId: from, toWalletId: to, amount: 1000, userId: 'nv-test' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'db_too_many_clients' });
      expect(res.headers['x-pod']).toBe('pod-91');
    } finally {
      held.forEach((c) => c.release());
      await app.close();
      await newPod.end();
      await running.end();
    }
  });
});
