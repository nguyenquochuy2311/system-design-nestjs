import { Inject, Injectable } from '@nestjs/common';
import { sql, type ExpressionBuilder, type Kysely, type Selectable, type Transaction } from 'kysely';
import { KYSELY, type Database } from '../../shared/db';

export type KeyRow = Selectable<Database['idempotency_keys']>;
export type Claim = { owned: true } | { owned: false; row: KeyRow | undefined };

/** Điều kiện tìm đúng một khóa. Khóa thuộc về người dùng: cùng chuỗi khóa ở hai người dùng là hai khóa khác nhau. */
const sameKey = (userId: string, key: string) => (eb: ExpressionBuilder<Database, 'idempotency_keys'>) =>
  eb.and([eb('user_id', '=', userId), eb('idempotency_key', '=', key)]);

@Injectable()
export class IdempotencyRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /**
   * [PATTERN] Giành khóa bằng một câu lệnh nguyên tử: chèn được thì request này xử lý; đụng ràng buộc duy nhất thì
   * đọc dòng đã có. Câu lệnh tự commit (ngoài transaction nghiệp vụ) để request trùng đến sau thấy "processing".
   */
  async claim(userId: string, key: string, method: string, path: string, fingerprint: string): Promise<Claim> {
    const inserted = await this.db
      .insertInto('idempotency_keys')
      .values({ user_id: userId, idempotency_key: key, request_method: method, request_path: path, fingerprint, locked_at: sql<Date>`now()` })
      .onConflict((oc) => oc.columns(['user_id', 'idempotency_key']).doNothing())
      .returning('created_at')
      .executeTakeFirst();
    if (inserted) return { owned: true };
    const row = await this.db.selectFrom('idempotency_keys').selectAll().where(sameKey(userId, key)).executeTakeFirst();
    return { owned: false, row };
  }

  /**
   * Tiếp quản khóa kẹt ở "processing" (tiến trình trước chết giữa chừng). Điều kiện thời gian nằm trong WHERE nên
   * hai request cùng tiếp quản thì chỉ một request cập nhật được dòng.
   */
  async takeOver(userId: string, key: string, lockTimeoutMs: number): Promise<boolean> {
    const r = await this.db
      .updateTable('idempotency_keys')
      .set({ locked_at: sql<Date>`now()` })
      .where(sameKey(userId, key))
      .where('status', '=', 'processing')
      .where('locked_at', '<', sql<Date>`now() - make_interval(secs => ${lockTimeoutMs / 1000})`)
      .executeTakeFirst();
    return r.numUpdatedRows === 1n;
  }

  /** [PATTERN] Lưu response và đánh dấu xong. Bản "sau" gọi trong chính transaction của nghiệp vụ. */
  async complete(executor: Kysely<Database> | Transaction<Database>, userId: string, key: string, code: number, body: string): Promise<void> {
    const r = await executor
      .updateTable('idempotency_keys')
      .set({ status: 'completed', response_code: code, response_body: body, locked_at: null, completed_at: sql<Date>`now()` })
      .where(sameKey(userId, key))
      .where('status', '=', 'processing')
      .executeTakeFirst();
    if (r.numUpdatedRows !== 1n) throw new Error(`Khóa ${userId}/${key} không còn ở trạng thái processing`);
  }

  /** Nhả khóa khi nghiệp vụ lỗi trước khi commit (validate, lỗi 5xx): không có gì được ghi nên gửi lại là an toàn. */
  async release(userId: string, key: string): Promise<void> {
    await this.db.deleteFrom('idempotency_keys').where(sameKey(userId, key)).where('status', '=', 'processing').execute();
  }

  /** Xóa tối đa `limit` khóa tạo trước `retentionHours` giờ; trả về số dòng đã xóa. */
  async deleteExpired(retentionHours: number, limit: number): Promise<number> {
    const r = await sql`
      DELETE FROM idempotency_keys
      WHERE ctid IN (
        SELECT ctid FROM idempotency_keys
        WHERE created_at < now() - make_interval(hours => ${retentionHours})
        LIMIT ${limit}
      )`.execute(this.db);
    return Number(r.numAffectedRows ?? 0n);
  }
}
