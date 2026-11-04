import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, DATABASE_URLS, resetDatabase } from './support/stack';

const PERMISSION_DENIED = '42501';

async function errorCodeOf(connectionString: string, query: string): Promise<string | undefined> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(query);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  } finally {
    await client.end();
  }
}

// Đo độc lập với code của lab: đọc thẳng catalog của PostgreSQL.
async function tablesWithManyWriters(admin: pg.Pool, schemas: string[], roles: string[]): Promise<string[]> {
  const { rows } = await admin.query<{ name: string }>(
    `SELECT table_schema || '.' || table_name AS name
     FROM information_schema.role_table_grants
     WHERE table_schema = ANY($1) AND grantee = ANY($2) AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
     GROUP BY 1 HAVING count(DISTINCT grantee) > 1 ORDER BY 1`,
    [schemas, roles],
  );
  return rows.map((row) => row.name);
}

describe('Dữ liệu của service nào thì chỉ service đó chạm được', () => {
  let admin: pg.Pool;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(() => resetDatabase(admin));

  it.each([
    ['shipping_rw đọc bảng đơn của order-service', DATABASE_URLS.shipping, 'SELECT * FROM ordering.orders'],
    ['shipping_rw ghi bảng đơn của order-service', DATABASE_URLS.shipping, "UPDATE ordering.orders SET address = 'x'"],
    ['shipping_rw đổi cấu trúc bảng đơn', DATABASE_URLS.shipping, 'ALTER TABLE ordering.orders DROP COLUMN address'],
    ['order_rw đọc bản sao của shipping', DATABASE_URLS.order, 'SELECT * FROM shipping.shipment_orders'],
    ['order_rw đổi cấu trúc bản sao', DATABASE_URLS.order, 'ALTER TABLE shipping.shipment_orders DROP COLUMN address'],
    ['shipping_rw gửi vào hàng đợi của order-service', DATABASE_URLS.shipping, "SELECT pgmq.send('order_events', '{}'::jsonb)"],
  ])('%s bị database từ chối', async (_label, url, query) => {
    expect(await errorCodeOf(url, query)).toBe(PERMISSION_DENIED);
  });

  it('mỗi service vẫn đọc được dữ liệu của chính nó', async () => {
    expect(await errorCodeOf(DATABASE_URLS.order, 'SELECT * FROM ordering.orders')).toBeUndefined();
    expect(await errorCodeOf(DATABASE_URLS.shipping, 'SELECT * FROM shipping.shipment_orders')).toBeUndefined();
  });

  it('trước: 5 bảng được cả hai service ghi', async () => {
    expect(await tablesWithManyWriters(admin, ['shared'], ['truoc_order', 'truoc_shipping'])).toEqual([
      'shared.delivery_attempts',
      'shared.order_items',
      'shared.order_status_history',
      'shared.orders',
      'shared.shops',
    ]);
  });

  it('sau: không bảng nào được hai service ghi', async () => {
    const schemas = ['ordering', 'shipping'];
    const roles = ['order_rw', 'shipping_rw'];
    expect(await tablesWithManyWriters(admin, schemas, roles)).toEqual([]);

    // Đối chứng để phép đo trên không rỗng vì lý do khác: mỗi bảng vẫn có đúng một role ghi được.
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(DISTINCT table_name)::int AS n FROM information_schema.role_table_grants
       WHERE table_schema = 'ordering' AND grantee = 'order_rw' AND privilege_type = 'INSERT'`,
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(3);
  });

  it('bản sao không có trường giá hay dòng hàng của đơn', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'shipping' AND table_name = 'shipment_orders'",
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([
      'address',
      'created_at',
      'delivery_window',
      'event_occurred_at',
      'order_id',
      'order_version',
      'replicated_at',
      'zone_code',
    ]);
  });
});
