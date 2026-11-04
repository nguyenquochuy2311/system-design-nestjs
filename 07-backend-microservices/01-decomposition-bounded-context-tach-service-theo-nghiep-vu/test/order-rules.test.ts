import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { orderTotalVnd, priceLines, UnknownProductError } from '../apps/ordering/pricing';
import { connectAdmin, logs, placeOrder, resetData, startSau, TWO_SKU_ORDER, type SauStack } from './support/stack';

describe('Quy tắc tính tiền của Ordering', () => {
  const snapshots = new Map([['SKU-1', { sku: 'SKU-1', productName: 'Áo', unitPriceVnd: 100_000 }]]);

  it('dòng hàng lấy tên và giá từ bản sao của Ordering', () => {
    expect(priceLines([{ sku: 'SKU-1', quantity: 2 }], snapshots)).toEqual([
      { sku: 'SKU-1', productName: 'Áo', unitPriceVnd: 100_000, quantity: 2 },
    ]);
  });

  it('SKU không có trong bản sao thì báo lỗi', () => {
    expect(() => priceLines([{ sku: 'SKU-2', quantity: 1 }], snapshots)).toThrow(UnknownProductError);
  });

  it('giảm giá theo phần trăm, làm tròn phần giảm xuống', () => {
    const lines = [{ sku: 'SKU-1', productName: 'Áo', unitPriceVnd: 33_333, quantity: 1 }];
    expect(orderTotalVnd(lines, 10)).toBe(33_333 - 3_333);
  });
});

describe('Đặt hàng qua Ordering', () => {
  let admin: pg.Pool;
  let stack: SauStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    logs.length = 0;
    await resetData(admin);
    stack = await startSau();
  });
  afterEach(() => stack.stopAll());

  async function reservedOf(sku: string): Promise<number> {
    const { rows } = await admin.query<{ reserved: number }>(
      'SELECT reserved FROM inventory.stock_items WHERE sku = $1',
      [sku],
    );
    return rows[0]?.reserved ?? -1;
  }

  it('khách bị khóa bị từ chối mà không có lời gọi mạng nào', async () => {
    const correlationId = randomUUID();

    const reply = await placeOrder(stack.entryUrl, { ...TWO_SKU_ORDER, customerId: 'KH-0000' }, correlationId);

    expect(reply.status).toBe(422);
    expect(logs.filter((line) => line.correlationId === correlationId && line.event === 'outbound')).toHaveLength(0);
  });

  it('SKU không có trong bản sao bị từ chối', async () => {
    const reply = await placeOrder(stack.entryUrl, { ...TWO_SKU_ORDER, items: [{ sku: 'KHONG-CO', quantity: 1 }] });
    expect(reply.status).toBe(422);
  });

  it('mã khuyến mãi được áp ngay trong Ordering', async () => {
    const reply = await placeOrder(stack.entryUrl, { ...TWO_SKU_ORDER, promoCode: 'TET10' });
    expect(reply.body.totalVnd).toBe(72_000);
  });

  it('thiếu một SKU thì không SKU nào bị giữ và đơn bị từ chối', async () => {
    await admin.query("UPDATE inventory.stock_items SET on_hand = 1 WHERE sku = 'SKU-0002'");

    const reply = await placeOrder(stack.entryUrl, TWO_SKU_ORDER);

    expect(reply.status).toBe(409);
    expect(await reservedOf('SKU-0001')).toBe(0);
    expect(await reservedOf('SKU-0002')).toBe(0);
    const { rows } = await admin.query('SELECT status FROM ordering.orders');
    expect(rows.map((row) => row.status)).toEqual(['REJECTED']);
  });

  it('Inventory tắt thì đơn thất bại rõ ràng, không kẹt ở PENDING', async () => {
    await stack.stop('inventory');

    const reply = await placeOrder(stack.entryUrl, TWO_SKU_ORDER);

    expect(reply.status).toBe(503);
    const { rows } = await admin.query('SELECT status FROM ordering.orders');
    expect(rows.map((row) => row.status)).toEqual(['FAILED']);
  });
});
