import type { Kysely } from 'kysely';
import type { Database } from '../shared/db.js';
import { toDto, transactionColumns, type TransactionDto } from '../shared/transaction.js';
import type { CursorPosition } from './cursor-codec.js';

/**
 * Bản "sau": phân trang theo GIÁ TRỊ (seek method). Trang kế tiếp = các dòng có khóa (created_at, id) nhỏ hơn khóa
 * của dòng cuối trang trước. Với index (merchant_id, created_at DESC, id DESC), PostgreSQL nhảy thẳng tới vị trí đó
 * trong B-tree và đọc limit + 1 mục, trang thứ mấy cũng vậy.
 */
export function keysetPageQuery(db: Kysely<Database>, merchantId: number, limit: number, after: CursorPosition | null) {
  let query = db.selectFrom('transactions').select(transactionColumns).where('merchant_id', '=', merchantId);
  if (after) {
    // [PATTERN] Row value comparison: (created_at, id) < (t, i). id là khóa phụ để thứ tự duy nhất khi trùng created_at.
    query = query.where(({ eb, refTuple, tuple }) => eb(refTuple('created_at', 'id'), '<', tuple(after.createdAt, after.id)));
  }
  return query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    // [PATTERN] Lấy dư một dòng để biết còn trang sau mà không cần COUNT(*).
    .limit(limit + 1);
}

export interface KeysetPage {
  items: TransactionDto[];
  /** Vị trí dòng cuối của trang này; null khi đã hết. */
  next: CursorPosition | null;
}

export async function listTransactionsAfter(
  db: Kysely<Database>,
  merchantId: number,
  limit: number,
  after: CursorPosition | null,
): Promise<KeysetPage> {
  const rows = await keysetPageQuery(db, merchantId, limit, after).execute();
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next = rows.length > limit && last ? { createdAt: last.created_at_iso, id: last.id } : null;
  return { items: items.map(toDto), next };
}
