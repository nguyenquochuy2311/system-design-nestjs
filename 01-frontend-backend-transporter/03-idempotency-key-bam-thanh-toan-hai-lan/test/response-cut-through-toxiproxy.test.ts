import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentClient } from '../src/shared/payment-client';
import { cutResponses, pointProxyTo, PROXY_URL } from '../bench/lib/toxiproxy';
import { paymentsByNote, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// Kịch bản gốc của bài, thu nhỏ: Toxiproxy cắt response của lần gửi đầu SAU khi server đã commit, client gửi lại.
describe('cắt response sau khi server commit (qua Toxiproxy)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '1': 10_000_000, '2': 10_000_000 }));
    await pointProxyTo(t.port);
  });
  afterAll(async () => {
    await cutResponses(false);
    await pointProxyTo(3100);
    await t.close();
  });

  const run = async (path: string, userId: string) => {
    const client = new PaymentClient({ baseUrl: PROXY_URL, path, timeoutMs: 2_000, maxAttempts: 4, backoffMs: 5 });
    const results = [];
    for (let i = 0; i < 5; i++) {
      const note = `cut-${path}-${randomUUID()}`;
      const outcome = await client.pay({ userId, merchantId: 7, amount: 10_000, note }, (attempt) => cutResponses(attempt === 1));
      results.push({ outcome, payments: await paymentsByNote(t.db, note) });
    }
    return results;
  };

  it('bản trước: mỗi lần response bị cắt rồi gửi lại là một giao dịch thừa', async () => {
    for (const { outcome, payments } of await run('/truoc/payments', '1')) {
      expect(outcome.attempts.map((a) => a.status ?? 'cắt')).toEqual(['cắt', 201]);
      expect(payments).toHaveLength(2);
    }
  });

  it('bản sau: lần gửi lại nhận bản phát lại của giao dịch đã commit, không có giao dịch thừa', async () => {
    for (const { outcome, payments } of await run('/sau/payments', '2')) {
      expect(outcome.attempts.map((a) => a.status ?? 'cắt')).toEqual(['cắt', 201]);
      expect(outcome.replayed).toBe(true);
      expect(payments).toHaveLength(1);
      expect(JSON.parse(outcome.body).paymentId).toBe(payments[0]!.id);
    }
  });
});
