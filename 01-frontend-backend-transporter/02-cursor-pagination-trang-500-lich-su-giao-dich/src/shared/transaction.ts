import { sql, type ExpressionBuilder } from 'kysely';
import type { Database } from './db.js';

/** Một dòng lịch sử giao dịch như API trả ra. */
export interface TransactionDto {
  id: string;
  createdAt: string;
  amount: number;
  kind: string;
  description: string;
}

/**
 * Cột cần đọc. created_at đọc thành chuỗi ISO có đủ 6 chữ số micro giây, giờ UTC, không đi qua `Date` của JavaScript
 * (chỉ tới mili giây): cursor phải mang đúng giá trị PostgreSQL đang so sánh (README mục 3.4).
 * Bí danh khác tên cột: `ORDER BY created_at` sẽ khớp cột xuất ra trước cột của bảng, nếu trùng tên thì PostgreSQL
 * sắp theo chuỗi to_char và không dùng được index.
 */
export const transactionColumns = (eb: ExpressionBuilder<Database, 'transactions'>) => [
  eb.ref('id').as('id'),
  sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('created_at_iso'),
  eb.ref('amount').as('amount'),
  eb.ref('kind').as('kind'),
  eb.ref('description').as('description'),
];

export interface TransactionRow {
  id: string;
  created_at_iso: string;
  amount: string;
  kind: string;
  description: string;
}

export function toDto(row: TransactionRow): TransactionDto {
  return { id: row.id, createdAt: row.created_at_iso, amount: Number(row.amount), kind: row.kind, description: row.description };
}
