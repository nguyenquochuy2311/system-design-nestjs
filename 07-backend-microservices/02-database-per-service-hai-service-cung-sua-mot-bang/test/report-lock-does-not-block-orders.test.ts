import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectAdmin,
  countRows,
  createOrder,
  DATABASE_URLS,
  resetDatabase,
  SauStack,
  send,
  TruocStack,
  waitUntil,
} from './support/stack';

async function holdShareLock(table: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: DATABASE_URLS.admin });
  await client.connect();
  await client.query('BEGIN');
  await client.query(`LOCK TABLE ${table} IN SHARE MODE`);
  return async () => {
    await client.query('ROLLBACK');
    await client.end();
  };
}

describe('Báo cáo giữ khóa trên bảng nó đọc', () => {
  let admin: pg.Pool;
  let stack: SauStack | TruocStack | undefined;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(() => resetDatabase(admin));
  afterEach(() => stack?.stopAll());

  it('trước: khóa trên bảng chung làm việc tạo đơn phải chờ', async () => {
    const truoc = await TruocStack.start();
    stack = truoc;
    const release = await holdShareLock('shared.orders');

    await expect(createOrder(truoc.orderUrl, undefined, 500)).rejects.toThrow();

    await release();
    await waitUntil(async () => (await countRows(admin, 'shared.orders')) === 1, 'đơn ghi được sau khi nhả khóa');
  });

  it('sau: khóa trên bản sao không chặn tạo đơn, chỉ làm bản sao trễ tới khi nhả khóa', async () => {
    const sau = await SauStack.start();
    stack = sau;
    const release = await holdShareLock('shipping.shipment_orders');

    const reply = await createOrder(sau.orderUrl, undefined, 500);

    expect(reply.status).toBe(201);
    expect(await countRows(admin, 'shipping.shipment_orders')).toBe(0);
    await release();
    await waitUntil(async () => (await countRows(admin, 'shipping.shipment_orders')) === 1, 'bản sao bắt kịp');
  });

  it('API báo cáo chạy được ở cả hai bản và từ chối chế độ lạ', async () => {
    const truoc = await TruocStack.start();
    const sau = await SauStack.start();
    try {
      for (const shippingUrl of [truoc.shippingUrl, sau.shippingUrl]) {
        for (const mode of ['plain', 'lock']) {
          expect((await send('POST', `${shippingUrl}/reports/delivery-success?mode=${mode}`)).status).toBe(200);
        }
        expect((await send('POST', `${shippingUrl}/reports/delivery-success?mode=xyz`)).status).toBe(400);
      }
    } finally {
      await truoc.stopAll();
      await sau.stopAll();
    }
  });
});
