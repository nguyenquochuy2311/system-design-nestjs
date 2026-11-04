import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { translateCatalogEvent } from '../apps/ordering/acl/catalog-event-translator';
import {
  changePrice,
  connectAdmin,
  placeOrder,
  resetData,
  sendCatalogEvent,
  snapshotPrice,
  startSau,
  startTruoc,
  TWO_SKU_ORDER,
  TWO_SKU_TOTAL_VND,
  waitUntil,
  type SauStack,
  type TruocStack,
} from './support/stack';

const NEW_PRICE = 77_000;

describe('Lớp dịch sự kiện của Ordering', () => {
  it('sự kiện v1 và v2 dịch ra cùng một mô hình của Ordering', () => {
    const expected = { sku: 'SKU-0001', productName: 'Áo', unitPriceVnd: 1000, priceVersion: 2 };
    const v1 = {
      eventType: 'ProductPriceChanged',
      schemaVersion: 1,
      sku: 'SKU-0001',
      displayName: 'Áo',
      priceVnd: 1000,
      priceVersion: 2,
    };
    const v2 = {
      eventType: 'ProductPriceChanged',
      schemaVersion: 2,
      sku: 'SKU-0001',
      title: 'Áo',
      listPrice: { amountVnd: 1000 },
      revision: 2,
    };
    expect(translateCatalogEvent(v1)).toEqual({ kind: 'apply', update: expected });
    expect(translateCatalogEvent(v2)).toEqual({ kind: 'apply', update: expected });
  });

  it('trường lạ trong sự kiện bị bỏ qua, không lọt vào mô hình của Ordering', () => {
    const translation = translateCatalogEvent({
      eventType: 'ProductPriceChanged',
      schemaVersion: 1,
      sku: 'SKU-0001',
      displayName: 'Áo',
      priceVnd: 1000,
      priceVersion: 2,
      seoKeywords: ['áo'],
    });
    expect(translation).toEqual({
      kind: 'apply',
      update: { sku: 'SKU-0001', productName: 'Áo', unitPriceVnd: 1000, priceVersion: 2 },
    });
  });

  it('sự kiện loại khác được bỏ qua, không phải lỗi', () => {
    expect(translateCatalogEvent({ eventType: 'ProductImageChanged', sku: 'SKU-0001' })).toEqual({ kind: 'ignore' });
  });
});

describe('Catalog đổi tên trường trong sự kiện', () => {
  let admin: pg.Pool;
  let stack: SauStack | TruocStack | undefined;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(() => resetData(admin));
  afterEach(() => stack?.stopAll());

  it('sau: Catalog phát sự kiện v2, Ordering vẫn nhận giá mới và đơn sau dùng giá đó', async () => {
    const sau = await startSau('v2');
    stack = sau;

    await changePrice(sau.urlOf('catalog'), 'SKU-0001', NEW_PRICE);
    await waitUntil(async () => (await snapshotPrice(admin, 'SKU-0001')) === NEW_PRICE, 'giá mới vào bản sao');

    const reply = await placeOrder(sau.entryUrl, TWO_SKU_ORDER);
    expect(reply.status).toBe(201);
    expect(reply.body.totalVnd).toBe(NEW_PRICE + 2 * 30_000);
  });

  it('sau: sự kiện đổi tên mà không báo phiên bản bị cách ly, sự kiện sau và việc đặt hàng vẫn chạy', async () => {
    const sau = await startSau();
    stack = sau;

    await sendCatalogEvent(admin, {
      eventType: 'ProductPriceChanged',
      schemaVersion: 1,
      sku: 'SKU-0001',
      tenHienThi: 'Đổi tên không báo trước',
      giaBan: 1,
      priceVersion: 99,
    });
    await changePrice(sau.urlOf('catalog'), 'SKU-0002', NEW_PRICE);
    await waitUntil(async () => (await snapshotPrice(admin, 'SKU-0002')) === NEW_PRICE, 'sự kiện sau vẫn được xử lý');

    const { rows } = await admin.query<{ reason: string; payload: { giaBan: number } }>(
      'SELECT reason, payload FROM ordering.quarantined_events',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.giaBan).toBe(1);
    expect(await snapshotPrice(admin, 'SKU-0001')).toBe(20_000);

    const reply = await placeOrder(sau.entryUrl, { ...TWO_SKU_ORDER, items: [{ sku: 'SKU-0001', quantity: 1 }] });
    expect(reply.status).toBe(201);
    expect(reply.body.totalVnd).toBe(20_000);
  });

  it('trước: product-service đổi tên cột giá, không đơn nào đặt được', async () => {
    const truoc = await startTruoc();
    stack = truoc;
    expect((await placeOrder(truoc.entryUrl, TWO_SKU_ORDER)).body.totalVnd).toBe(TWO_SKU_TOTAL_VND);

    await admin.query('ALTER TABLE truoc.products RENAME COLUMN price_vnd TO list_price_vnd');
    try {
      const reply = await placeOrder(truoc.entryUrl, TWO_SKU_ORDER);
      expect(reply.status).toBeGreaterThanOrEqual(500);
    } finally {
      await admin.query('ALTER TABLE truoc.products RENAME COLUMN list_price_vnd TO price_vnd');
    }
  });
});
