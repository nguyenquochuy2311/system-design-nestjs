import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { splitAddress, translateOrderEvent } from '../apps/shipping-service/order-event-translator';
import {
  connectAdmin,
  countRows,
  createOrder,
  NEW_ORDER,
  resetDatabase,
  SauStack,
  send,
  sendOrderEvent,
  waitUntil,
} from './support/stack';

const orderEvent = (orderId: string, orderVersion: number, deliveryAddress: string) => ({
  eventType: 'OrderAddressChanged',
  schemaVersion: 1,
  eventId: randomUUID(),
  occurredAt: new Date().toISOString(),
  orderId,
  orderVersion,
  deliveryAddress,
  deliveryWindow: '08:00-12:00',
  zoneCode: 'Z1',
});

describe('Lớp dịch sự kiện của shipping', () => {
  it('sự kiện thiếu trường bị cách ly, trường lạ bị bỏ qua', () => {
    expect(translateOrderEvent({ eventType: 'OrderCreated', orderId: 'x' }).kind).toBe('quarantine');
    expect(translateOrderEvent('không phải object').kind).toBe('quarantine');
    const translation = translateOrderEvent({ ...orderEvent('x', 1, 'A'), totalVnd: 999 });
    expect(translation.kind).toBe('apply');
    expect(JSON.stringify(translation)).not.toContain('999');
  });

  it('tách địa chỉ theo đúng quy tắc của migration', () => {
    expect(splitAddress('12 Lê Lợi, Phường 1, Quận 1')).toEqual({ street: '12 Lê Lợi', ward: 'Phường 1', district: 'Quận 1' });
    expect(splitAddress('Không có dấu phẩy')).toEqual({ street: 'Không có dấu phẩy', ward: '', district: '' });
  });
});

describe('Bản sao shipment_orders', () => {
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

  const archived = () => countRows(admin, 'pgmq.a_order_events');

  async function replicaAddress(orderId: string): Promise<string | undefined> {
    const { rows } = await admin.query<{ address: string }>(
      'SELECT address FROM shipping.shipment_orders WHERE order_id = $1',
      [orderId],
    );
    return rows[0]?.address;
  }

  it('đơn mới tới được bản sao, không cần gọi order-service', async () => {
    const { body } = await createOrder(stack.orderUrl);
    const orderId = String(body.orderId);

    await waitUntil(async () => (await replicaAddress(orderId)) !== undefined, 'bản sao có đơn');

    const shipment = await send('GET', `${stack.shippingUrl}/shipments/${orderId}`);
    expect(shipment.status).toBe(200);
    expect(shipment.body).toMatchObject({ address: NEW_ORDER.address, zone_code: 'Z1', order_version: 1 });
  });

  it('đổi địa chỉ ở order-service thì bản sao cập nhật theo', async () => {
    const orderId = String((await createOrder(stack.orderUrl)).body.orderId);

    const changed = await send('PATCH', `${stack.orderUrl}/orders/${orderId}/address`, { address: 'Địa chỉ mới' });

    expect(changed.body.version).toBe(2);
    await waitUntil(async () => (await replicaAddress(orderId)) === 'Địa chỉ mới', 'địa chỉ mới vào bản sao');
  });

  it('sự kiện tới hai lần chỉ tạo một dòng', async () => {
    const orderId = randomUUID();
    const event = orderEvent(orderId, 1, 'A');

    await sendOrderEvent(admin, event);
    await sendOrderEvent(admin, event);
    await waitUntil(async () => (await archived()) === 2, 'hai sự kiện đã xử lý');

    expect(await countRows(admin, 'shipping.shipment_orders')).toBe(1);
  });

  it('sự kiện cũ tới muộn không kéo địa chỉ về bản trước', async () => {
    const orderId = randomUUID();

    await sendOrderEvent(admin, orderEvent(orderId, 5, 'Bản 5'));
    await sendOrderEvent(admin, orderEvent(orderId, 4, 'Bản 4'));
    await waitUntil(async () => (await archived()) === 2, 'hai sự kiện đã xử lý');

    expect(await replicaAddress(orderId)).toBe('Bản 5');
  });

  it('sự kiện hỏng bị cách ly, sự kiện sau vẫn chạy', async () => {
    const orderId = randomUUID();

    await sendOrderEvent(admin, { eventType: 'OrderCreated', orderId });
    await sendOrderEvent(admin, orderEvent(orderId, 1, 'Hợp lệ'));
    await waitUntil(async () => (await replicaAddress(orderId)) === 'Hợp lệ', 'sự kiện sau được xử lý');

    expect(await countRows(admin, 'shipping.quarantined_events')).toBe(1);
  });
});
