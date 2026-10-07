import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { ensureForeignKeyIndexes } from './helpers';

const db = createDb();

beforeAll(() => ensureForeignKeyIndexes(db));
afterAll(() => db.destroy());

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

function collectNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(collectNodes)];
}

describe('kế hoạch truy vấn items theo order_id (cần dữ liệu seed đủ lớn)', () => {
  it('dùng index trên order_items.order_id, không quét tuần tự', async () => {
    const ids = Array.from({ length: PAGE_IDS }, (_, i) => 250_000 - i);
    const { rows } = await sql<{ 'QUERY PLAN': { Plan: PlanNode }[] }>`
      EXPLAIN (FORMAT JSON) SELECT * FROM order_items WHERE order_id = ANY(${ids})`.execute(db);
    const nodes = collectNodes(rows[0]!['QUERY PLAN'][0]!.Plan);
    const onItems = nodes.filter((n) => n['Relation Name'] === 'order_items');
    expect(onItems.length).toBeGreaterThan(0);
    expect(onItems.some((n) => n['Node Type'] === 'Seq Scan')).toBe(false);
    expect(onItems.some((n) => /Index Scan|Bitmap Heap Scan/.test(n['Node Type']))).toBe(true);
  });
});

const PAGE_IDS = 50;
