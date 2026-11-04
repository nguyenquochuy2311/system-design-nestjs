import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, reservedOf, resetData, SagaStack, waitUntil } from './support/stack';

const DEADLINE_SECONDS = 1;

describe('Hết hạn giữ hàng', () => {
  let admin: pg.Pool;
  let stack: SagaStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetData(admin);
    stack = await new SagaStack(DEADLINE_SECONDS).startAll();
  });
  afterEach(() => stack.stopAll());

  const stateIs = (orderId: string, state: string) =>
    waitUntil(async () => (await stack.view(orderId)).state === state, `saga ${state}`);

  it('đang chờ thanh toán: chưa nhả hàng cho tới khi chốt được với cổng', async () => {
    await stack.stopPayment();

    const orderId = await stack.place();
    await stateIs(orderId, 'VOIDING');

    expect(await reservedOf(admin)).toBe(2);
    await stack.startPayment();
    await stateIs(orderId, 'CANCELLED');
    expect(await reservedOf(admin)).toBe(0);
    expect((await stack.report(admin)).mismatched).toBe(0);
  });

  it('cổng đã trừ tiền trước khi hết hạn: khách được hoàn tiền, không mất tiền cho đơn đã hủy', async () => {
    await stack.stopPayment();
    const orderId = await stack.place();
    await stateIs(orderId, 'VOIDING');
    stack.gateway.charges.set(orderId, 'CAPTURED');

    await stack.startPayment();
    await stateIs(orderId, 'CANCELLED');

    expect(stack.gateway.charges.get(orderId)).toBe('REFUNDED');
    const report = await stack.report(admin);
    expect(report.cancelledButCharged).toBe(0);
    expect(report.refunded).toBe(1);
  });

  it('hủy xong, lệnh trừ tiền tới muộn không trừ được nữa', async () => {
    await stack.stopPayment();
    const orderId = await stack.place();
    await stateIs(orderId, 'VOIDING');

    await stack.startPayment();
    await stateIs(orderId, 'CANCELLED');

    expect(stack.gateway.charges.get(orderId)).not.toBe('CAPTURED');
  });

  it('kho không trả lời: saga không kẹt ở RESERVING', async () => {
    await stack.stopInventory();

    const orderId = await stack.place();
    await stateIs(orderId, 'COMPENSATING');

    await stack.startInventory();
    await stateIs(orderId, 'CANCELLED');
    expect(await reservedOf(admin)).toBe(0);
  });

  it('đơn đã xác nhận thì hạn chót không làm gì', async () => {
    const orderId = await stack.place();
    await stateIs(orderId, 'CONFIRMED');

    await new Promise((resolve) => setTimeout(resolve, (DEADLINE_SECONDS + 1) * 1_000));

    expect((await stack.view(orderId)).status).toBe('CONFIRMED');
  });
});
