import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  changePrice,
  connectAdmin,
  placeOrder,
  resetData,
  sendCatalogEvent,
  snapshotPrice,
  startSau,
  TWO_SKU_ORDER,
  TWO_SKU_TOTAL_VND,
  waitUntil,
  type SauStack,
} from './support/stack';

const priceEvent = (priceVnd: number, priceVersion: number) => ({
  eventType: 'ProductPriceChanged',
  schemaVersion: 1,
  sku: 'SKU-0001',
  displayName: 'Sản phẩm 1',
  priceVnd,
  priceVersion,
});

async function archivedCount(admin: pg.Pool): Promise<number> {
  const { rows } = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM pgmq.a_catalog_events');
  return rows[0]?.n ?? 0;
}

describe('Giá đã chốt trong Ordering', () => {
  let admin: pg.Pool;
  let stack: SauStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetData(admin);
    stack = await startSau();
  });
  afterEach(() => stack.stopAll());

  it('Catalog đổi giá sau khi đặt: đơn cũ giữ nguyên giá, đơn mới dùng giá mới', async () => {
    const before = await placeOrder(stack.entryUrl, TWO_SKU_ORDER);

    await changePrice(stack.urlOf('catalog'), 'SKU-0001', 55_000);
    await waitUntil(async () => (await snapshotPrice(admin, 'SKU-0001')) === 55_000, 'giá mới vào bản sao');
    const after = await placeOrder(stack.entryUrl, TWO_SKU_ORDER);

    expect(after.body.totalVnd).toBe(55_000 + 2 * 30_000);
    const { rows } = await admin.query<{ total_vnd: string; unit_price_vnd: string }>(
      `SELECT o.total_vnd, l.unit_price_vnd FROM ordering.orders o
       JOIN ordering.order_lines l ON l.order_id = o.id WHERE o.id = $1 AND l.sku = 'SKU-0001'`,
      [before.body.orderId],
    );
    expect(Number(rows[0]?.total_vnd)).toBe(TWO_SKU_TOTAL_VND);
    expect(Number(rows[0]?.unit_price_vnd)).toBe(20_000);
  });

  it('sự kiện cũ tới muộn không kéo giá về bản trước', async () => {
    await sendCatalogEvent(admin, priceEvent(60_000, 5));
    await waitUntil(async () => (await snapshotPrice(admin, 'SKU-0001')) === 60_000, 'bản 5 vào bản sao');

    await sendCatalogEvent(admin, priceEvent(40_000, 4));
    await waitUntil(async () => (await archivedCount(admin)) === 2, 'bản 4 đã được xử lý');

    expect(await snapshotPrice(admin, 'SKU-0001')).toBe(60_000);
  });

  it('sự kiện tới hai lần cho cùng một kết quả', async () => {
    await sendCatalogEvent(admin, priceEvent(60_000, 5));
    await sendCatalogEvent(admin, priceEvent(60_000, 5));
    await waitUntil(async () => (await archivedCount(admin)) === 2, 'hai sự kiện đã được xử lý');

    expect(await snapshotPrice(admin, 'SKU-0001')).toBe(60_000);
  });

  it('đổi giá và sự kiện cùng commit: giá không đổi thì không có sự kiện', async () => {
    const response = await fetch(`${stack.urlOf('catalog')}/products/KHONG-CO/price`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priceVnd: 1000 }),
    });

    expect(response.status).toBe(404);
    const { rows } = await admin.query<{ n: number }>(
      'SELECT (SELECT count(*) FROM pgmq.q_catalog_events)::int + (SELECT count(*) FROM pgmq.a_catalog_events)::int AS n',
    );
    expect(rows[0]?.n).toBe(0);
  });
});
