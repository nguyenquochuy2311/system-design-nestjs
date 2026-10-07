import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { PAGE_SIZE } from '../src/shared/order-list';
import { listOrdersNaive } from '../src/truoc/order-list.naive-repository';
import { listOrders } from '../src/sau/order-list.repository';
import { ensureForeignKeyIndexes } from './helpers';

const db = createDb();

beforeAll(() => ensureForeignKeyIndexes(db));
afterAll(() => db.destroy());

describe('tải theo lô cho kết quả giống hệt vòng lặp', () => {
  // Trang 0 (đơn mới nhất, gồm cả đơn do POST /place-order tạo), trang giữa, và trang vượt quá cuối.
  it.each([0, 7, 123])('trang %i: hai phiên bản trả đúng cùng dữ liệu, cùng thứ tự', async (page) => {
    const naive = await listOrdersNaive(db, page);
    const batch = await listOrders(db, page);
    expect(batch).toEqual(naive);
  });

  it('trang rỗng trả về mảng rỗng ở cả hai phiên bản', async () => {
    expect(await listOrders(db, 10_000_000)).toEqual([]);
    expect(await listOrdersNaive(db, 10_000_000)).toEqual([]);
  });

  it('đơn không có giao hàng được trả về shipment = null ở cả hai phiên bản', async () => {
    // Seed: đơn có id chia hết cho 10 không có bản ghi giao hàng. Chọn đơn 250000 và tính trang chứa nó
    // (sắp xếp id giảm dần) thay vì giả định trang 0, vì trang 0 chứa đơn mới do POST /place-order tạo.
    const { max } = await db.selectFrom('orders').select((eb) => eb.fn.max('id').as('max')).executeTakeFirstOrThrow();
    const page = Math.floor((max! - 250_000) / PAGE_SIZE);
    for (const run of [listOrders, listOrdersNaive]) {
      const rows = await run(db, page);
      const order = rows.find((o) => o.id === 250_000);
      expect(order).toBeDefined();
      expect(order!.shipment).toBeNull();
    }
  });
});
