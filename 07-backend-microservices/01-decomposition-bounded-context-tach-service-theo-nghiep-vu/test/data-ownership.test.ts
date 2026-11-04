import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { DATABASE_URLS } from './support/stack';

async function errorCodeOf(url: string, sql: string): Promise<string | undefined> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  } finally {
    await client.end();
  }
}

const PERMISSION_DENIED = '42501';

describe('Dữ liệu thuộc về context nào thì chỉ context đó đọc được', () => {
  it.each([
    ['Ordering đọc bảng sản phẩm của Catalog', DATABASE_URLS.ordering, 'SELECT * FROM catalog.products'],
    ['Ordering đọc tồn kho của Inventory', DATABASE_URLS.ordering, 'SELECT * FROM inventory.stock_items'],
    ['Catalog đọc đơn hàng của Ordering', DATABASE_URLS.catalog, 'SELECT * FROM ordering.orders'],
    ['Payment đọc đơn hàng của Ordering', DATABASE_URLS.payment, 'SELECT * FROM ordering.orders'],
    ['Inventory đọc hàng đợi sự kiện', DATABASE_URLS.inventory, 'SELECT * FROM pgmq.q_catalog_events'],
  ])('%s bị database từ chối', async (_label, url, sql) => {
    expect(await errorCodeOf(url, sql)).toBe(PERMISSION_DENIED);
  });

  it('mỗi context vẫn đọc được dữ liệu của chính nó', async () => {
    expect(await errorCodeOf(DATABASE_URLS.ordering, 'SELECT * FROM ordering.orders')).toBeUndefined();
    expect(await errorCodeOf(DATABASE_URLS.catalog, 'SELECT * FROM catalog.products')).toBeUndefined();
  });
});
