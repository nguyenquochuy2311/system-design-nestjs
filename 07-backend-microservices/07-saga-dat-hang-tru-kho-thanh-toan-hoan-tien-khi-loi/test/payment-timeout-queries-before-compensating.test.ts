import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, reservedOf, resetData, SagaStack, waitUntil } from './support/stack';

describe('Cổng thanh toán timeout, kết quả chưa biết', () => {
  let admin: pg.Pool;
  let stack: SagaStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetData(admin);
    stack = await new SagaStack().startAll();
    stack.gateway.behavior.timeoutRate = 1;
  });
  afterEach(() => stack.stopAll());

  const until = (orderId: string, status: string) =>
    waitUntil(async () => (await stack.view(orderId)).status === status, `đơn ${status}`);

  it('cổng thực ra đã trừ tiền: tra cứu thấy thành công, không bù, đơn xác nhận', async () => {
    stack.gateway.behavior.timeoutChargedRatio = 1;

    const orderId = await stack.place();

    await until(orderId, 'CONFIRMED');
    const view = await stack.view(orderId);
    expect(view.history.map((item) => item.to_state)).not.toContain('COMPENSATING');
    expect((await stack.report(admin)).mismatched).toBe(0);
  });

  it('cổng chưa trừ: gửi lại cùng key rồi xác nhận, chỉ trừ một lần', async () => {
    stack.gateway.behavior.timeoutChargedRatio = 0;

    const orderId = await stack.place();

    await until(orderId, 'CONFIRMED');
    expect(stack.gateway.charges.get(orderId)).toBe('CAPTURED');
    expect([...stack.gateway.charges.keys()]).toHaveLength(1);
  });

  it('nhiều đơn timeout cùng lúc: không đơn nào lệch giữa ba nơi', async () => {
    stack.gateway.behavior.timeoutChargedRatio = 0.5;
    stack.gateway.behavior.declineRate = 0.2;

    const orderIds = await Promise.all(Array.from({ length: 30 }, () => stack.place()));

    await waitUntil(async () => (await stack.report(admin)).unfinished === 0, 'mọi saga kết thúc', 15_000);
    expect(orderIds).toHaveLength(30);
    expect((await stack.report(admin)).mismatched).toBe(0);
    expect(await reservedOf(admin)).toBe((await stack.report(admin)).confirmed * 2);
  });
});
