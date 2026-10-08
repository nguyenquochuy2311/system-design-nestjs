import { CompiledQuery, sql, type Compilable, type Kysely } from 'kysely';
import type { CursorPosition } from '../sau/cursor-codec.js';
import type { Database } from './db.js';

/** Các nút của kế hoạch mà bài cần đọc: loại nút, index dùng, số dòng thật, buffer. */
export interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Recheck Cond'?: string;
  Filter?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

export interface ExplainResult {
  Plan: PlanNode;
  'Planning Time'?: number;
  'Execution Time'?: number;
}

/** EXPLAIN đúng câu SQL (và tham số) mà repository chạy, không viết lại tay. */
export async function explain(db: Kysely<Database>, query: Compilable, opts: { analyze: boolean } = { analyze: true }): Promise<ExplainResult> {
  const compiled = query.compile();
  const options = opts.analyze ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON';
  const result = await db.executeQuery<{ 'QUERY PLAN': ExplainResult[] }>(
    CompiledQuery.raw(`EXPLAIN (${options}) ${compiled.sql}`, [...compiled.parameters]),
  );
  return result.rows[0]!['QUERY PLAN'][0]!;
}

export function flattenPlan(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

/** Tóm tắt: chuỗi loại nút (kèm index), số dòng nút quét đọc ra, tổng buffer của cả câu. */
export function summarizePlan(result: ExplainResult) {
  const nodes = flattenPlan(result.Plan);
  const scan = nodes.find((n) => /Scan/.test(n['Node Type']) && !/Bitmap Index/.test(n['Node Type'])) ?? nodes.at(-1)!;
  return {
    nodes: nodes.map((n) => (n['Index Name'] ? `${n['Node Type']} (${n['Index Name']})` : n['Node Type'])),
    scanRows: (scan['Actual Rows'] ?? 0) * (scan['Actual Loops'] ?? 1),
    sharedHit: result.Plan['Shared Hit Blocks'] ?? 0,
    sharedRead: result.Plan['Shared Read Blocks'] ?? 0,
    planningMs: result['Planning Time'] ?? 0,
    executionMs: result['Execution Time'] ?? 0,
  };
}

/** Vị trí (created_at, id) của dòng cuối trang `page - 1`: cursor mà client đang cầm khi xin trang `page`. */
export async function positionBeforePage(db: Kysely<Database>, merchantId: number, page: number, size: number): Promise<CursorPosition | null> {
  if (page <= 1) return null;
  const row = await sql<{ created_at_iso: string; id: string }>`
    SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso, id
    FROM transactions WHERE merchant_id = ${merchantId}
    ORDER BY created_at DESC, id DESC OFFSET ${(page - 1) * size - 1} LIMIT 1`.execute(db);
  const r = row.rows[0];
  if (!r) throw new Error(`merchant ${merchantId} không có trang ${page}`);
  return { createdAt: r.created_at_iso, id: r.id };
}
