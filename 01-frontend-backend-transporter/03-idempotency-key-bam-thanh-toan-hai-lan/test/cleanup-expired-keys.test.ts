import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CleanupExpiredKeysJob } from '../src/sau/idempotency/cleanup-expired-keys.job';
import { setupTestDb, startTestApp, type TestApp } from './support/test-app';

describe('job dọn khóa quá hạn', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '1': 1_000_000 }), { retentionHours: 24 });
  });
  afterAll(() => t.close());

  it('xóa khóa tạo trước thời hạn lưu giữ (kể cả khóa kẹt processing), giữ khóa còn hạn', async () => {
    const insert = (key: string, age: string, status: 'processing' | 'completed') =>
      t.db
        .insertInto('idempotency_keys')
        .values({
          user_id: '1', idempotency_key: key, request_method: 'POST', request_path: '/sau/payments', fingerprint: 'x',
          status, locked_at: null, created_at: sql<Date>`now() - ${age}::interval`,
        })
        .execute();
    const [old1, old2, old3, fresh] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await insert(old1, '25 hours', 'completed');
    await insert(old2, '30 days', 'completed');
    await insert(old3, '25 hours', 'processing');
    await insert(fresh, '23 hours', 'completed');
    // Lô 2 dòng: phải lặp hai lượt mới xóa hết 3 khóa quá hạn.
    const deleted = await t.app.get(CleanupExpiredKeysJob).run(2);
    expect(deleted).toBe(3);
    const left = await t.db.selectFrom('idempotency_keys').select('idempotency_key').execute();
    expect(left.map((r) => r.idempotency_key)).toEqual([fresh]);
  });
});
