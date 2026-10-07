import { AsyncLocalStorage } from 'node:async_hooks';

interface QueryLog {
  count: number;
  statements: string[];
}

const storage = new AsyncLocalStorage<QueryLog>();

/** Được gọi từ hook `log` của Kysely cho mỗi câu SQL; chỉ ghi khi đang trong `countQueries`. */
export function recordQuery(sql: string): void {
  const log = storage.getStore();
  if (!log) return;
  log.count += 1;
  log.statements.push(sql);
}

/**
 * [PATTERN] Bộ đếm câu SQL theo từng "request": chạy `fn` và trả về số câu SQL nó đã bắn ra.
 * Dùng AsyncLocalStorage để hai request đồng thời không đếm lẫn nhau.
 */
export async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; count: number; statements: string[] }> {
  const log: QueryLog = { count: 0, statements: [] };
  const result = await storage.run(log, fn);
  return { result, count: log.count, statements: log.statements };
}
