/**
 * Kế hoạch truy vấn: truy vấn seek đi thẳng vào index phức hợp và chỉ đọc limit + 1 dòng ở trang 500,
 * còn OFFSET đọc đủ 9.980 dòng rồi bỏ. EXPLAIN chạy trên đúng câu SQL mà repository sinh ra.
 */
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keysetPageQuery } from '../src/sau/transactions-keyset.repository.js';
import type { Database } from '../src/shared/db.js';
import { explain, flattenPlan, positionBeforePage, summarizePlan } from '../src/shared/explain.js';
import { offsetPageQuery } from '../src/truoc/transactions-offset.repository.js';
import { seedHistory, setupTestDb } from './support/test-db.js';

let db: Kysely<Database>;

beforeAll(async () => {
  db = await setupTestDb();
  await seedHistory(db, 1, 12_000);
  for (let m = 2; m <= 20; m++) await seedHistory(db, m, 1_000);
});
afterAll(async () => {
  await db.destroy();
});

describe('truy vấn seek (bản sau)', () => {
  it('trang 500: Index Scan trên index (merchant_id, created_at DESC, id DESC), không Sort, đọc đúng 21 dòng', async () => {
    const after = await positionBeforePage(db, 1, 500, 20);
    const plan = await explain(db, keysetPageQuery(db, 1, 20, after));
    const nodes = flattenPlan(plan.Plan);
    const scan = nodes.find((n) => n['Node Type'] === 'Index Scan');
    expect(scan?.['Index Name']).toBe('transactions_merchant_created_id_idx');
    expect(scan?.['Index Cond']).toMatch(/ROW\(created_at, id\) < ROW\(/);
    expect(nodes.map((n) => n['Node Type'])).not.toContain('Sort');
    expect(summarizePlan(plan).scanRows).toBe(21);
  });
});

describe('OFFSET (bản trước), cùng index', () => {
  it('trang 500: nút quét đọc 10.000 dòng để trả 20', async () => {
    const plan = await explain(db, offsetPageQuery(db, 1, 500, 20));
    expect(summarizePlan(plan).scanRows).toBe(10_000);
  });
});
