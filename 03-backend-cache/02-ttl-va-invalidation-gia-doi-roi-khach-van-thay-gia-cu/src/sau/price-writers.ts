import type { Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { applyDuePromotions, setProductPrice } from '../shared/page.repository';

/**
 * Đường ghi 1, bản sau: admin sửa giá và ghi sự kiện trong cùng transaction. Không gọi Redis ở đây:
 * worker chỉ thấy sự kiện sau khi transaction commit, nên lệnh xóa cache luôn đến sau lần ghi DB.
 */
export function adminSetPrice(db: Kysely<Database>, id: number, price: number): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const updated = await setProductPrice(trx, id, price);
    if (updated) await trx.insertInto('price_outbox').values({ product_id: id, source: 'admin' }).execute(); // [PATTERN] outbox
    return updated;
  });
}

// Đường ghi 2, bản sau: job CSV là sql/sau/import-prices.sql, thêm một câu INSERT vào outbox.

/** Đường ghi 3, bản sau: job khuyến mãi theo lịch, mỗi sản phẩm đổi giá một sự kiện trong cùng transaction. */
export function runPromoTick(db: Kysely<Database>, now: Date): Promise<number[]> {
  return db.transaction().execute(async (trx) => {
    const ids = await applyDuePromotions(trx, now);
    if (ids.length) await trx.insertInto('price_outbox').values(ids.map((id) => ({ product_id: id, source: 'promo' as const }))).execute(); // [PATTERN] outbox
    return ids;
  });
}
