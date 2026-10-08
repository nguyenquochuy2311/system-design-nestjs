import type { Kysely } from 'kysely';
import type { Database } from '../shared/db.js';
import { toDto, transactionColumns, type TransactionDto } from '../shared/transaction.js';

/**
 * Bản "trước": phân trang theo VỊ TRÍ. Trang 500 cỡ 20 là `OFFSET 9980`: PostgreSQL vẫn phải đọc 9.980 dòng rồi bỏ đi.
 * Thứ tự chỉ theo created_at (không có khóa phụ), đúng như API cũ ở mục 1 của README.
 */
export function offsetPageQuery(db: Kysely<Database>, merchantId: number, page: number, size: number) {
  return db
    .selectFrom('transactions')
    .select(transactionColumns)
    .where('merchant_id', '=', merchantId)
    .orderBy('created_at', 'desc')
    .limit(size)
    .offset((page - 1) * size);
}

export interface OffsetPage {
  items: TransactionDto[];
  page: number;
  size: number;
}

export async function listTransactionsByPage(db: Kysely<Database>, merchantId: number, page: number, size: number): Promise<OffsetPage> {
  const rows = await offsetPageQuery(db, merchantId, page, size).execute();
  return { items: rows.map(toDto), page, size };
}
