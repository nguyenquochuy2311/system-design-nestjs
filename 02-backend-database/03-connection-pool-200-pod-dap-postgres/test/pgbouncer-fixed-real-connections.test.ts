import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPooledPool } from '../src/sau/db-pool';
import { createDirectPool } from '../src/truoc/db-pool';
import { adminClient, connectionLimit, realConnectionBudget, resetPgBouncers, sampleWhile, settle } from './helpers';

let admin: pg.Client;
let budget: number;

beforeAll(async () => {
  admin = await adminClient();
  budget = await realConnectionBudget();
});
afterAll(() => admin.end());

/** Mỗi pod chạy 10 transaction ngắn cùng lúc (mỗi cái giữ kết nối 50 ms), như 10 request chuyển tiền đồng thời. */
async function burst(pools: pg.Pool[]) {
  const work = pools.flatMap((pool) => Array.from({ length: 10 }, () => settle(pool.query('SELECT pg_sleep(0.05)'))));
  const { result, peak } = await sampleWhile(admin, Promise.all(work));
  return { failed: result.filter((r) => !r.ok), total: result.length, peak };
}

describe('sau: pod nối qua PgBouncer transaction mode, pool 10 mỗi pod', () => {
  it.each([10, 40])(
    '%i pod × 10 transaction đồng thời: 0 lỗi, kết nối thật không vượt 2 × default_pool_size',
    async (podCount) => {
      expect(budget).toBe(20);
      await resetPgBouncers();
      const pods = Array.from({ length: podCount }, (_, i) => createPooledPool(i));
      try {
        const { failed, total, peak } = await burst(pods);
        expect(total).toBe(podCount * 10); // 100 hoặc 400 kết nối phía pod
        expect(failed).toEqual([]);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(budget); // [PATTERN] số kết nối thật không đổi theo số pod
      } finally {
        await Promise.all(pods.map((p) => p.end()));
      }
    },
  );

  it('đối chứng: cùng 40 pod và cùng tải nhưng nối thẳng thì DB chạm trần và từ chối kết nối', async () => {
    await resetPgBouncers();
    const limit = await connectionLimit(admin);
    const pods = Array.from({ length: 40 }, (_, i) => createDirectPool(i, 10));
    try {
      const { failed, peak } = await burst(pods);
      expect(peak).toBeLessThanOrEqual(limit);
      expect(peak).toBeGreaterThanOrEqual(limit - 10); // chạm trần (có thể hụt vài chỗ khi kết nối ập vào cùng lúc)
      expect(failed.length).toBeGreaterThan(0);
    } finally {
      await Promise.all(pods.map((p) => p.end()));
    }
  });
});
