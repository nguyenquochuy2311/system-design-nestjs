import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../shared/db';

/** Ai đang thao tác, vì sao, thuộc request nào: trigger nhật ký đọc ba giá trị này từ biến cấu hình. */
export interface Actor {
  userId: string;
  reason?: string;
  requestId?: string;
}

/**
 * [PATTERN] Mọi lần ghi của ứng dụng đi qua đây: mở transaction, đặt app.user_id / app.reason / app.request_id
 * bằng set_config(..., true) — tương đương SET LOCAL — rồi mới chạy câu ghi. Trigger audit.log_change() đọc
 * các biến này để biết người thực hiện.
 *
 * Vì sao `true` (cục bộ transaction): biến hết hạn ở COMMIT/ROLLBACK, nên khi kết nối được trả về pool, hoặc
 * PgBouncer chế độ transaction đưa kết nối thật cho client khác, giá trị không rò sang request của người khác
 * (test actor-context-no-leak). Dùng set_config thay cho SET LOCAL vì SET không nhận tham số $1.
 */
export async function withActor<T>(db: Kysely<Database>, actor: Actor, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  if (!actor.userId.trim()) throw new Error('withActor: thiếu userId của người thực hiện');
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${actor.userId}, true),
                     set_config('app.reason', ${actor.reason ?? ''}, true),
                     set_config('app.request_id', ${actor.requestId ?? ''}, true)`.execute(trx); // [PATTERN]
    return fn(trx);
  });
}
