import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, NEW_ORDER, reservedOf, resetData, SagaStack, TruocStack, waitUntil } from './support/stack';

describe('Luồng đặt hàng qua saga', () => {
  let admin: pg.Pool;
  let stack: SagaStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetData(admin);
    stack = await new SagaStack().startAll();
  });
  afterEach(() => stack.stopAll());

  const until = (orderId: string, status: string) =>
    waitUntil(async () => (await stack.view(orderId)).status === status, `đơn ${status}`);

  it('thành công: đơn xác nhận, tiền đã trừ, hàng còn giữ cho đơn', async () => {
    const orderId = await stack.place();

    await until(orderId, 'CONFIRMED');

    expect(stack.gateway.charges.get(orderId)).toBe('CAPTURED');
    expect(await reservedOf(admin)).toBe(NEW_ORDER.quantity);
    expect((await stack.report(admin)).mismatched).toBe(0);
  });

  it('thanh toán bị từ chối: hàng được nhả và đơn hủy', async () => {
    stack.gateway.behavior.declineRate = 1;

    const orderId = await stack.place();

    await until(orderId, 'CANCELLED');
    expect(await reservedOf(admin)).toBe(0);
    expect((await stack.report(admin)).mismatched).toBe(0);
  });

  it('trả lời được đơn đang ở bước nào, vì sao', async () => {
    stack.gateway.behavior.declineRate = 1;

    const orderId = await stack.place();
    await until(orderId, 'CANCELLED');

    const view = await stack.view(orderId);
    expect(view.history.map((item) => `${item.event}>${item.to_state}`)).toEqual([
      'OrderPlaced>RESERVING',
      'StockReserved>CHARGING',
      'PaymentFailed>COMPENSATING',
      'StockReleased>CANCELLED',
    ]);
  });

  it('hết hàng: đơn hủy mà không gọi cổng thanh toán', async () => {
    await admin.query("UPDATE inventory.stock_items SET on_hand = 1 WHERE sku = 'SKU-0001'");

    const orderId = await stack.place();

    await until(orderId, 'CANCELLED');
    expect(stack.gateway.charges.size).toBe(0);
  });

  it('API trả 202 ngay, không chờ cả quy trình', async () => {
    stack.gateway.behavior.latencyMs = 200;
    const startedAt = performance.now();

    const orderId = await stack.place();

    expect(performance.now() - startedAt).toBeLessThan(150);
    expect((await stack.view(orderId)).status).toBe('PENDING');
    await until(orderId, 'CONFIRMED');
  });
});

describe('Bản trước: try/catch gọi hoàn kho', () => {
  let admin: pg.Pool;
  let stack: TruocStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetData(admin);
    stack = await new TruocStack().start();
  });
  afterEach(() => stack.stopAll());

  it('timeout bị coi là thất bại: đơn hủy trong khi khách đã bị trừ tiền', async () => {
    stack.gateway.behavior.timeoutRate = 1;
    stack.gateway.behavior.timeoutChargedRatio = 1;

    expect(await stack.place()).toBe(402);

    expect((await stack.report(admin)).cancelledButCharged).toBe(1);
  });

  it('lời gọi hoàn kho lỗi thì không ai nhớ phải bù: hàng bị giữ, đơn treo', async () => {
    stack.gateway.behavior.declineRate = 1;
    stack.gateway.behavior.latencyMs = 150;

    const placing = stack.place();
    await waitUntil(async () => {
      const { rows } = await admin.query('SELECT 1 FROM truoc.reservations');
      return rows.length > 0;
    }, 'hàng đã giữ');
    await stack.stopInventory();
    expect(await placing).toBe(500);

    const report = await stack.report(admin);
    expect(report.unfinishedHoldingStock).toBe(1);
  });
});
