import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectAdmin,
  placeOrder,
  resetData,
  startSau,
  startTruoc,
  TWO_SKU_ORDER,
  type SauStack,
  type TruocStack,
} from './support/stack';

const ORDERS = 50;

describe('Một service phía sau bị tắt trong lúc khách đặt hàng', () => {
  let admin: pg.Pool;
  let stack: SauStack | TruocStack | undefined;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(() => resetData(admin));
  afterEach(() => stack?.stopAll());

  it('sau: tắt Catalog, mọi đơn vẫn được xác nhận', async () => {
    const sau = await startSau();
    stack = sau;
    const catalogUrl = sau.urlOf('catalog');
    await sau.stop('catalog');
    await expect(fetch(`${catalogUrl}/products/SKU-0001`)).rejects.toThrow();

    const replies = await Promise.all(Array.from({ length: ORDERS }, () => placeOrder(sau.entryUrl, TWO_SKU_ORDER)));

    expect(replies.filter((reply) => reply.status === 201)).toHaveLength(ORDERS);
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM ordering.orders WHERE status = 'CONFIRMED'");
    expect(rows[0].n).toBe(ORDERS);
  });

  it('trước: tắt product-service, không đơn nào đặt được', async () => {
    const truoc = await startTruoc();
    stack = truoc;
    await truoc.stop('product-service');

    const replies = await Promise.all(Array.from({ length: ORDERS }, () => placeOrder(truoc.entryUrl, TWO_SKU_ORDER)));

    expect(replies.filter((reply) => reply.status === 201)).toHaveLength(0);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM truoc.orders');
    expect(rows[0].n).toBe(0);
  });
});
