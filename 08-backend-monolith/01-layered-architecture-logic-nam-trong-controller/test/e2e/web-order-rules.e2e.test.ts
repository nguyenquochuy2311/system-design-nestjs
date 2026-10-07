import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, VARIANTS } from '../support/apps';
import { addUnpaidOrder, createCustomer, createProduct, ordersOf } from '../support/db-fixtures';
import { ORDER_RULE_CASES } from '../support/order-rule-cases';

// Test đặc tả (characterization) của luồng web: cùng bảng quy tắc, cùng body lỗi cho bản "trước" và "sau".
// Với bản "trước", HTTP + DB là cách duy nhất chạm được quy tắc vì nó nằm trong controller.
const queries: string[] = [];
let ctx: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  ctx = await startApp((sql) => queries.push(sql));
});
afterAll(() => ctx.app.close());

describe.each(VARIANTS)('%s: bảng quy tắc đặt hàng qua HTTP + PostgreSQL', (variant) => {
  it.each(ORDER_RULE_CASES)('$name', async (c) => {
    const customerId = await createCustomer(ctx.db, c.tier, c.creditLimit);
    if (c.outstanding > 0) await addUnpaidOrder(ctx.db, customerId, c.outstanding);
    const productIds = await Promise.all(c.products.map((p) => createProduct(ctx.db, p.unitPrice, p.isPromo)));
    const items = c.items.map((i) => ({ productId: productIds[i.product], quantity: i.quantity }));

    const res = await request(ctx.app.getHttpServer()).post(`/${variant}/orders`).send({ customerId, items });

    if (c.expected.kind === 'placed') {
      const { kind: _kind, ...money } = c.expected;
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ orderId: expect.any(Number), customerId, ...money });
      const saved = await ordersOf(ctx.db, customerId);
      expect(saved.at(-1)).toMatchObject({ id: res.body.orderId, channel: 'web', ...money });
    } else {
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: c.expected.error, shortfall: c.expected.shortfall });
      expect(await ordersOf(ctx.db, customerId)).toHaveLength(c.outstanding > 0 ? 1 : 0);
    }
  });
});

describe('trước và sau trả cùng mã lỗi và cùng body cho đầu vào sai', () => {
  const invalidBodies: [string, (customerId: number, productId: number) => unknown][] = [
    ['body không phải object', () => 'abc'],
    ['customerId không phải số nguyên dương', (_c, p) => ({ customerId: -1, items: [{ productId: p, quantity: 1 }] })],
    ['không có dòng hàng', (c) => ({ customerId: c, items: [] })],
    ['quantity bằng 0', (c, p) => ({ customerId: c, items: [{ productId: p, quantity: 0 }] })],
    ['productId không hợp lệ', (c) => ({ customerId: c, items: [{ productId: 'x', quantity: 1 }] })],
    ['khách không tồn tại', (_c, p) => ({ customerId: 2_000_000_000, items: [{ productId: p, quantity: 1 }] })],
    ['sản phẩm không tồn tại', (c) => ({ customerId: c, items: [{ productId: 2_000_000_000, quantity: 1 }] })],
  ];

  it.each(invalidBodies)('%s', async (_name, makeBody) => {
    const customerId = await createCustomer(ctx.db, 'gold', 1_000_000_000);
    const productId = await createProduct(ctx.db, 100_000);
    const body = makeBody(customerId, productId);
    const send = (v: string) =>
      request(ctx.app.getHttpServer()).post(`/${v}/orders`).set('content-type', 'application/json').send(JSON.stringify(body));
    const [truoc, sau] = await Promise.all([send('truoc'), send('sau')]);
    expect(truoc.status).toBeGreaterThanOrEqual(400);
    expect({ status: sau.status, body: sau.body }).toEqual({ status: truoc.status, body: truoc.body });
  });
});

it('một đơn web dùng cùng số câu SQL ở hai bản (để phép so độ trễ HTTP công bằng)', async () => {
  const customerId = await createCustomer(ctx.db, 'silver', 1_000_000_000);
  const productIds = await Promise.all([createProduct(ctx.db, 100_000), createProduct(ctx.db, 200_000, true)]);
  const counts: Record<string, number> = {};
  for (const variant of VARIANTS) {
    queries.length = 0;
    const res = await request(ctx.app.getHttpServer())
      .post(`/${variant}/orders`)
      .send({ customerId, items: productIds.map((productId) => ({ productId, quantity: 2 })) });
    expect(res.status).toBe(201);
    counts[variant] = queries.length;
  }
  expect(counts.sau).toBe(counts.truoc);
});
