import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../libs/platform/migrate';
import {
  connectAdmin,
  countRows,
  createOrder,
  logs,
  resetDatabase,
  SauStack,
  shippingMigrations,
  splitAddressSql,
  TruocStack,
  waitUntil,
} from './support/stack';

const ORDERS = 10;

describe('Đội shipping tách cột address thành street, ward, district', () => {
  let admin: pg.Pool;
  let stack: SauStack | TruocStack | undefined;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(() => resetDatabase(admin));
  afterEach(() => stack?.stopAll());

  it('trước: migration của shipping làm order-service trả 500 cho mọi đơn', async () => {
    const truoc = await TruocStack.start();
    stack = truoc;
    expect((await createOrder(truoc.orderUrl)).status).toBe(201);

    await admin.query(splitAddressSql());

    const replies = await Promise.all(Array.from({ length: ORDERS }, () => createOrder(truoc.orderUrl)));
    expect(replies.map((reply) => reply.status)).toEqual(Array(ORDERS).fill(500));
    expect(await countRows(admin, 'shared.orders')).toBe(1);
  });

  it('sau: order-service không lỗi đơn nào, và shipping bản mới bắt kịp mọi sự kiện đã chờ', async () => {
    const sau = await SauStack.start();
    stack = sau;
    expect((await createOrder(sau.orderUrl)).status).toBe(201);
    await waitUntil(async () => (await countRows(admin, 'shipping.shipment_orders')) === 1, 'bản sao đầu tiên');

    await applyMigrations(shippingMigrations());

    const replies = await Promise.all(Array.from({ length: ORDERS }, () => createOrder(sau.orderUrl)));
    expect(replies.map((reply) => reply.status)).toEqual(Array(ORDERS).fill(201));
    expect(await countRows(admin, 'ordering.orders')).toBe(ORDERS + 1);

    // Shipping bản cũ còn ghi vào cột address đã xóa: lỗi nằm gọn ở phía nó, sự kiện chưa mất.
    await waitUntil(async () => logs.some((line) => line.event === 'order_event_failed'), 'consumer bản cũ gặp lỗi');
    expect(await countRows(admin, 'shipping.shipment_orders')).toBe(1);

    await sau.stopShipping();
    await sau.startShipping('split');
    await waitUntil(
      async () => (await countRows(admin, 'shipping.shipment_orders')) === ORDERS + 1,
      'shipping bản mới bắt kịp',
    );

    const { rows } = await admin.query<{ street: string; ward: string; district: string }>(
      'SELECT street, ward, district FROM shipping.shipment_orders',
    );
    for (const row of rows) {
      expect(row).toEqual({ street: '12 Lê Lợi', ward: 'Phường Bến Nghé', district: 'Quận 1' });
    }
    expect(await countRows(admin, 'pgmq.q_order_events')).toBe(0);
  });
});
