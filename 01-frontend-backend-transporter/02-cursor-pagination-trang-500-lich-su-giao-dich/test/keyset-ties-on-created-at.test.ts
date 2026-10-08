/**
 * Test (b) của mục 8: nhiều giao dịch trùng created_at (giao dịch nhập theo lô) nằm vắt qua ranh giới trang.
 * Cùng với đó: created_at chỉ khác nhau ở micro giây, và trang cuối biết là hết nhờ lấy dư một dòng.
 */
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CursorPageResponse } from '../src/app.js';
import type { Database } from '../src/shared/db.js';
import { flipByCursor } from './support/flip.js';
import { duplicates, idsInDisplayOrder, insertAt, seedHistory, setupTestDb, testApp } from './support/test-db.js';

let db: Kysely<Database>;
let app: FastifyInstance;

const LO_TRUNG = '2026-09-01T10:00:00.000000Z';

beforeAll(async () => {
  db = await setupTestDb();
  app = testApp(db);
  // Merchant 10: 30 dòng mới hơn, 50 dòng TRÙNG HỆT created_at, 30 dòng cũ hơn.
  await insertAt(db, 10, Array.from({ length: 30 }, (_, k) => `2026-09-01T10:00:${String(30 + k).padStart(2, '0')}.000000Z`));
  await insertAt(db, 10, Array.from({ length: 50 }, () => LO_TRUNG));
  await insertAt(db, 10, Array.from({ length: 30 }, (_, k) => `2026-09-01T09:59:${String(k).padStart(2, '0')}.000000Z`));
  // Merchant 11: 25 dòng trong cùng một mili giây, lệch nhau từng micro giây (ranh giới trang 20 rơi vào giữa).
  await insertAt(db, 11, Array.from({ length: 25 }, (_, k) => `2026-09-01T10:00:00.123${String(k + 400).padStart(3, '0')}Z`));
  await insertAt(db, 11, Array.from({ length: 10 }, (_, k) => `2026-09-01T09:00:0${k}.000000Z`));
  // Merchant 12: đúng 40 dòng. Merchant 13: dữ liệu theo quy luật của seed (khối 5 dòng trùng và khối lệch micro giây),
  // thêm 3 dòng mới hơn ở đầu để ranh giới trang 20 lệch khỏi ranh giới khối và rơi vào giữa nhóm trùng.
  await insertAt(db, 12, Array.from({ length: 40 }, (_, k) => `2026-09-02T00:00:${String(k).padStart(2, '0')}.000000Z`));
  await insertAt(db, 13, ['2026-09-03T00:00:02.000000Z', '2026-09-03T00:00:01.000000Z', '2026-09-03T00:00:00.000000Z']);
  await seedHistory(db, 13, 997);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('khóa sắp xếp có created_at trùng nhau', () => {
  it.each([1, 7, 20, 21, 49])('50 dòng trùng created_at vắt qua ranh giới trang (limit %i): không sót, không lặp', async (limit) => {
    const expected = await idsInDisplayOrder(db, 10);
    const { ids } = await flipByCursor(app, 10, limit);
    expect(duplicates(ids)).toEqual([]);
    expect(ids).toEqual(expected);
  });

  it('created_at chỉ khác nhau ở micro giây, ranh giới trang nằm giữa cùng một mili giây: không sót dòng nào', async () => {
    const expected = await idsInDisplayOrder(db, 11);
    const { ids, pages } = await flipByCursor(app, 11, 20);
    expect(pages).toBe(2);
    expect(ids).toEqual(expected);
  });

  it('dữ liệu theo quy luật seed, ranh giới trang cắt ngang nhóm trùng created_at, limit 20: khớp đúng thứ tự (created_at, id)', async () => {
    const rows = await db.selectFrom('transactions').select(['id', sql<string>`created_at::text`.as('t')]).where('merchant_id', '=', 13)
      .orderBy('created_at', 'desc').orderBy('id', 'desc').execute();
    const splitGroups = rows.filter((r, k) => k > 0 && k % 20 === 0 && rows[k - 1]!.t === r.t).length;
    expect(splitGroups).toBeGreaterThan(0); // dữ liệu thật sự có ranh giới trang nằm giữa nhóm trùng
    const expected = rows.map((r) => r.id);
    const { ids } = await flipByCursor(app, 13, 20);
    expect(ids).toEqual(expected);
  });

  it('createdAt trả ra giữ đủ 6 chữ số micro giây', async () => {
    const res = await app.inject({ method: 'GET', url: '/merchants/11/transactions?limit=3' });
    expect(res.json<CursorPageResponse>().items.map((t) => t.createdAt)).toEqual([
      '2026-09-01T10:00:00.123424Z',
      '2026-09-01T10:00:00.123423Z',
      '2026-09-01T10:00:00.123422Z',
    ]);
  });
});

describe('lấy limit + 1 dòng', () => {
  it('đúng 40 dòng, limit 20: trang 2 trả nextCursor null, không có trang rỗng thứ 3', async () => {
    const { ids, pages } = await flipByCursor(app, 12, 20);
    expect(ids).toHaveLength(40);
    expect(pages).toBe(2);
  });
});
