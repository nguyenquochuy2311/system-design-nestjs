/**
 * Test (a) của mục 8: lật hết danh sách trong khi có giao dịch mới chen vào đầu danh sách.
 * Bản trước (OFFSET) lặp đúng số dòng bị đẩy lùi; bản sau (keyset) không lặp, không sót.
 */
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/shared/db.js';
import { flipByCursor, flipByPage } from './support/flip.js';
import { duplicates, idsInDisplayOrder, insertNewTransactions, seedHistory, setupTestDb, testApp } from './support/test-db.js';

let db: Kysely<Database>;
let app: FastifyInstance;

beforeAll(async () => {
  db = await setupTestDb();
  app = testApp(db);
  for (const merchantId of [1, 2, 3]) await seedHistory(db, merchantId, 1_000);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('bản trước: page= và OFFSET', () => {
  it('mỗi lần có 2 giao dịch mới chen vào giữa hai lần lật trang, 2 dòng cuối trang trước hiện lại ở trang sau', async () => {
    const before = await idsInDisplayOrder(db, 1);
    const ids = await flipByPage(app, 1, 20, 10, async () => void (await insertNewTransactions(db, 1, 2)));
    const dup = duplicates(ids);
    expect(dup).toHaveLength(2 * 9); // 9 ranh giới trang × 2 dòng bị đẩy lùi
    expect(dup.slice(0, 2)).toEqual(before.slice(18, 20)); // đúng 2 dòng cuối của trang 1
  });
});

describe('bản sau: cursor và truy vấn seek', () => {
  it('cùng kịch bản chèn 2 giao dịch sau mỗi trang: lật hết danh sách không lặp, không sót, đúng thứ tự', async () => {
    const before = await idsInDisplayOrder(db, 2);
    const { ids, pages } = await flipByCursor(app, 2, 20, async () => void (await insertNewTransactions(db, 2, 2)));
    expect(pages).toBe(50);
    expect(duplicates(ids)).toEqual([]);
    expect(ids).toEqual(before);
  });

  it('một luồng khác chèn giao dịch liên tục trong lúc lật: không lặp, không sót dòng nào đã có từ trước', async () => {
    const before = await idsInDisplayOrder(db, 3);
    let running = true;
    let inserted = 0;
    const writer = (async () => {
      while (running) {
        await insertNewTransactions(db, 3, 1);
        inserted += 1;
      }
    })();
    while (inserted < 5) await new Promise((r) => setTimeout(r, 5)); // chắc chắn luồng ghi đã chạy trước trang 1

    const insertedBeforeFlip = inserted;
    const { ids } = await flipByCursor(app, 3, 20);
    running = false;
    await writer;

    expect(inserted - insertedBeforeFlip).toBeGreaterThan(0); // có ghi xen vào giữa các trang
    expect(duplicates(ids)).toEqual([]);
    // Trang 1 có thể chứa vài giao dịch mới chèn trước lúc đọc nó; phần còn lại phải đúng y danh sách cũ.
    const old = new Set(before);
    const maxOldId = before.reduce((m, id) => (BigInt(id) > m ? BigInt(id) : m), 0n);
    expect(ids.filter((id) => old.has(id))).toEqual(before);
    expect(ids.filter((id) => !old.has(id)).every((id) => BigInt(id) > maxOldId)).toBe(true);
  });
});
