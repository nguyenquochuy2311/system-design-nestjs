import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, countRows, createOrder, resetDatabase, SauStack, waitUntil } from './support/stack';

const ORDERS = 30;

describe('shipping-service tắt để bảo trì', () => {
  let admin: pg.Pool;
  let stack: SauStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetDatabase(admin);
    stack = await SauStack.start();
  });
  afterEach(() => stack.stopAll());

  it('order-service vẫn nhận đơn, và shipping mở lại thì nhận đủ sự kiện', async () => {
    await stack.stopShipping();

    const replies = await Promise.all(Array.from({ length: ORDERS }, () => createOrder(stack.orderUrl)));

    expect(replies.every((reply) => reply.status === 201)).toBe(true);
    expect(await countRows(admin, 'shipping.shipment_orders')).toBe(0);
    expect(await countRows(admin, 'pgmq.q_order_events')).toBe(ORDERS);

    await stack.startShipping('single');
    await waitUntil(async () => (await countRows(admin, 'shipping.shipment_orders')) === ORDERS, 'nhận đủ sự kiện');

    const { rows } = await admin.query<{ missing: number }>(
      `SELECT count(*)::int AS missing FROM ordering.orders o
       WHERE NOT EXISTS (SELECT 1 FROM shipping.shipment_orders s WHERE s.order_id = o.id)`,
    );
    expect(rows[0]?.missing).toBe(0);
  });
});
