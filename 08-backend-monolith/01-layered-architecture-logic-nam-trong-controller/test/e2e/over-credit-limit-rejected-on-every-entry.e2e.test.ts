import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTRY_POINTS, placeVia, startApp } from '../support/apps';
import { addUnpaidOrder, createCustomer, createProduct, ordersOf } from '../support/db-fixtures';

let ctx: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.app.close());

/** Khách hạn mức 100 triệu đang nợ 80 triệu đặt 30 sản phẩm × 1 triệu (sau chiết khấu Vàng: 28,5 triệu). */
async function overLimitOrder() {
  const customerId = await createCustomer(ctx.db, 'gold', 100_000_000);
  await addUnpaidOrder(ctx.db, customerId, 80_000_000);
  const productId = await createProduct(ctx.db, 1_000_000);
  return { customerId, items: [{ productId, quantity: 30 }] };
}

describe('trước: quy tắc hạn mức chỉ đúng ở luồng web (tái hiện lỗi)', () => {
  it('web từ chối đơn vượt hạn mức với 422', async () => {
    const { customerId, items } = await overLimitOrder();
    const outcome = await placeVia(ctx.app, 'truoc', 'web', customerId, items);
    expect(outcome).toMatchObject({ accepted: false, status: 422 });
  });

  it('CSV của đại lý NHẬN đơn vượt hạn mức: bản sao không có bước kiểm', async () => {
    const { customerId, items } = await overLimitOrder();
    const outcome = await placeVia(ctx.app, 'truoc', 'csv', customerId, items);
    expect(outcome).toMatchObject({ accepted: true, total: 28_500_000 });
    expect(await ordersOf(ctx.db, customerId)).toHaveLength(2);
  });

  it('sàn TMĐT NHẬN đơn vì chỉ so 28,5 triệu với hạn mức 100 triệu, quên công nợ 80 triệu', async () => {
    const { customerId, items } = await overLimitOrder();
    const outcome = await placeVia(ctx.app, 'truoc', 'marketplace', customerId, items);
    expect(outcome).toMatchObject({ accepted: true });
  });
});

describe('sau: đơn vượt hạn mức bị từ chối qua cả ba đường vào', () => {
  it.each(ENTRY_POINTS)('%s từ chối, không ghi đơn nào', async (entry) => {
    const { customerId, items } = await overLimitOrder();
    const outcome = await placeVia(ctx.app, 'sau', entry, customerId, items);
    expect(outcome.accepted).toBe(false);
    expect(outcome).toMatchObject({ reason: 'Vượt hạn mức công nợ, còn thiếu 8500000 đồng' });
    expect(await ordersOf(ctx.db, customerId)).toHaveLength(1); // chỉ còn khoản công nợ cũ
  });
});
