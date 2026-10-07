import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { applyDuePromotions, setProductPrice } from '../shared/page.repository';
import { cacheKeys } from '../shared/pages';

const logger = new Logger('truoc.price');

/**
 * Đường ghi 1, bản trước: admin sửa giá, commit, rồi xóa đúng MỘT key là trang chi tiết.
 * Trang danh mục và deal trang chủ cũng chứa giá này nhưng không ai biết key của chúng, nên chờ TTL.
 */
export async function adminSetPrice(db: Kysely<Database>, redis: Redis, id: number, price: number): Promise<boolean> {
  const updated = await db.transaction().execute((trx) => setProductPrice(trx, id, price));
  if (updated) {
    try {
      await redis.del(cacheKeys.product('truoc', id));
    } catch (err) {
      // Xóa hụt thì không có gì làm lại: giá cũ nằm tới hết TTL.
      logger.error(`không xóa được ${cacheKeys.product('truoc', id)}: ${(err as Error).message}; giá cũ còn tới hết TTL`);
    }
  }
  return updated;
}

// Đường ghi 2, bản trước: job CSV là sql/truoc/import-prices.sql, chỉ ghi PostgreSQL.

/** Đường ghi 3, bản trước: job khuyến mãi theo lịch chỉ ghi PostgreSQL. Trả id sản phẩm đã đổi giá. */
export function runPromoTick(db: Kysely<Database>, now: Date): Promise<number[]> {
  return db.transaction().execute((trx) => applyDuePromotions(trx, now));
}
