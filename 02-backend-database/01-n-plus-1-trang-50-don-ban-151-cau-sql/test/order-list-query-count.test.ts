import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { countQueries } from '../src/shared/query-counter';
import { PAGE_SIZE } from '../src/shared/order-list';
import { listOrdersNaive } from '../src/truoc/order-list.naive-repository';
import { listOrders } from '../src/sau/order-list.repository';
import { ensureForeignKeyIndexes } from './helpers';

const db = createDb();

beforeAll(() => ensureForeignKeyIndexes(db)); // có index để test chạy nhanh; số câu SQL không phụ thuộc index
afterAll(() => db.destroy());

describe('số câu SQL mỗi lần tải trang danh sách đơn', () => {
  it('phiên bản vòng lặp tái hiện N+1: đúng 1 + 50 × 3 = 151 câu', async () => {
    const { result, count } = await countQueries(() => listOrdersNaive(db, 0));
    expect(result).toHaveLength(PAGE_SIZE);
    expect(count).toBe(1 + PAGE_SIZE * 3);
  });

  it('phiên bản tải theo lô dùng tối đa 4 câu, không phụ thuộc số đơn trên trang', async () => {
    const { result, count } = await countQueries(() => listOrders(db, 0));
    expect(result).toHaveLength(PAGE_SIZE);
    expect(count).toBeLessThanOrEqual(4);
  });

  it('hai request chạy đồng thời không đếm lẫn câu SQL của nhau', async () => {
    const [naive, batch] = await Promise.all([
      countQueries(() => listOrdersNaive(db, 1)),
      countQueries(() => listOrders(db, 1)),
    ]);
    expect(naive.count).toBe(151);
    expect(batch.count).toBeLessThanOrEqual(4);
  });
});
