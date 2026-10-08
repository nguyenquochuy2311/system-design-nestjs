import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentClient } from '../src/shared/payment-client';
import { balanceOf, paymentsByNote, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// (e) Lỗi giữa chừng: tiền đã trừ trong transaction nhưng bước lưu response thất bại (DB lỗi, tiến trình chết...).
// Lỗi được giả lập bằng trigger trong schema test: lần ghi "completed" thứ lẻ bị từ chối. Sequence không rollback theo
// transaction, nên lần thứ nhất lỗi và lần thứ hai qua, kể cả khi transaction lỗi đã rollback.
describe('(e) lưu response cùng transaction với nghiệp vụ', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '1': 1_000_000 }));
    await sql
      .raw(`
        CREATE SEQUENCE fault_seq;
        CREATE FUNCTION fail_every_other_completion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF nextval('fault_seq') % 2 = 1 THEN
            RAISE EXCEPTION 'lỗi giả lập khi lưu response của khóa %', NEW.idempotency_key;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER fault_on_complete BEFORE UPDATE ON idempotency_keys
          FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION fail_every_other_completion();`)
      .execute(t.db);
  });
  afterAll(() => t.close());

  it('lưu response thất bại sau khi đã trừ tiền: tiền được hoàn nguyên, client gửi lại chỉ tạo một giao dịch', async () => {
    const note = `e-${randomUUID()}`;
    const client = new PaymentClient({ baseUrl: t.url, path: '/sau/payments', timeoutMs: 5_000, maxAttempts: 3, backoffMs: 10 });
    const seenBeforeRetry: number[] = [];
    const outcome = await client.pay({ userId: '1', merchantId: 7, amount: 50_000, note }, async (attempt) => {
      if (attempt === 2) seenBeforeRetry.push((await paymentsByNote(t.db, note)).length);
    });
    expect(outcome.attempts.map((a) => a.status)).toEqual([500, 201]);
    // Lần 1 lỗi ở bước lưu response nên cả lần trừ tiền cũng rollback: chưa có giao dịch nào trước lần gửi lại.
    expect(seenBeforeRetry).toEqual([0]);
    expect(await paymentsByNote(t.db, note)).toHaveLength(1);
    expect(await balanceOf(t.db, '1')).toBe(950_000);
  });
});
