import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTRY_POINTS, placeVia, startApp, VARIANTS } from '../support/apps';
import { createCustomer, createProduct } from '../support/db-fixtures';

// Chính sách chiết khấu hạng Vàng đang áp dụng (phần vạn). bench/rule-change-drill.ts đổi chính sách trong
// mã nguồn rồi chạy lại file này với EXPECTED_GOLD_BPS=700 để đếm đường vào nào áp dụng theo.
const EXPECTED_GOLD_BPS = Number(process.env.EXPECTED_GOLD_BPS ?? 500);

let ctx: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.app.close());

async function goldOrder(unitPrice: number, quantity: number) {
  const customerId = await createCustomer(ctx.db, 'gold', 10_000_000_000);
  const productId = await createProduct(ctx.db, unitPrice);
  return { customerId, items: [{ productId, quantity }] };
}

describe.each(VARIANTS)('%s: đơn hạng Vàng 10 triệu áp đúng chính sách hiện hành', (variant) => {
  it.each(ENTRY_POINTS)('%s', async (entry) => {
    const { customerId, items } = await goldOrder(2_000_000, 5);
    const outcome = await placeVia(ctx.app, variant, entry, customerId, items);
    expect(outcome).toMatchObject({ accepted: true, total: 10_000_000 - (10_000_000 * EXPECTED_GOLD_BPS) / 10_000 });
  });
});

describe('đơn hạng Vàng 60 triệu (có khoản cộng 1% cho đơn lớn)', () => {
  it('trước: sàn TMĐT tính khác web vì bản sao chưa có khoản cộng 1% (tái hiện lỗi)', async () => {
    const totals: Record<string, number> = {};
    for (const entry of ENTRY_POINTS) {
      const { customerId, items } = await goldOrder(20_000_000, 3);
      const outcome = await placeVia(ctx.app, 'truoc', entry, customerId, items);
      totals[entry] = outcome.accepted ? outcome.total : -1;
    }
    expect(totals.web).toBe(totals.csv);
    expect(totals.marketplace).toBeGreaterThan(totals.web as number);
  });

  it('sau: ba đường vào ra cùng một tổng tiền', async () => {
    const totals = new Set<number>();
    for (const entry of ENTRY_POINTS) {
      const { customerId, items } = await goldOrder(20_000_000, 3);
      const outcome = await placeVia(ctx.app, 'sau', entry, customerId, items);
      totals.add(outcome.accepted ? outcome.total : -1);
    }
    expect([...totals]).toHaveLength(1);
  });
});
