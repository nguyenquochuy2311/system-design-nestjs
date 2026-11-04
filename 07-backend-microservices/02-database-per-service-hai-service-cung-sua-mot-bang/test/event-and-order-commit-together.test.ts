import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, countRows, createOrder, resetDatabase, SauStack, send } from './support/stack';

const FAIL_TRIGGER = `
  CREATE OR REPLACE FUNCTION public.lab_fail() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION 'lỗi cố ý của test'; END $$;`;

describe('Ghi đơn và sự kiện cùng một transaction', () => {
  let admin: pg.Pool;
  let stack: SauStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetDatabase(admin);
    await admin.query(FAIL_TRIGGER);
    stack = await SauStack.start();
    await stack.stopShipping();
  });
  afterEach(async () => {
    await admin.query('DROP TRIGGER IF EXISTS lab_fail ON pgmq.q_order_events');
    await stack.stopAll();
  });

  // Lỗi phải xảy ra sau lúc gửi sự kiện, tức lúc commit: lỗi ở bước trước thì sự kiện chưa được gửi, nên không chứng minh gì.
  it('transaction ghi đơn lỗi lúc commit thì sự kiện đã gửi cũng mất theo', async () => {
    await admin.query(
      `CREATE CONSTRAINT TRIGGER lab_fail AFTER INSERT ON ordering.orders
       DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.lab_fail()`,
    );

    expect((await createOrder(stack.orderUrl)).status).toBe(500);

    expect(await countRows(admin, 'ordering.orders')).toBe(0);
    expect(await countRows(admin, 'pgmq.q_order_events')).toBe(0);
  });

  it('gửi sự kiện lỗi thì đơn cũng không được ghi', async () => {
    await admin.query(
      'CREATE TRIGGER lab_fail BEFORE INSERT ON pgmq.q_order_events FOR EACH ROW EXECUTE FUNCTION public.lab_fail()',
    );

    expect((await createOrder(stack.orderUrl)).status).toBe(500);

    expect(await countRows(admin, 'ordering.orders')).toBe(0);
  });

  it('API đọc đơn vẫn là đường tra cứu cho trường ngoài bản sao', async () => {
    const orderId = String((await createOrder(stack.orderUrl)).body.orderId);

    const reply = await send('GET', `${stack.orderUrl}/orders/${orderId}`);

    expect(reply.status).toBe(200);
    expect(reply.body.total_vnd).toBe(150_000);
    expect((await send('GET', `${stack.orderUrl}/orders/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });
});
