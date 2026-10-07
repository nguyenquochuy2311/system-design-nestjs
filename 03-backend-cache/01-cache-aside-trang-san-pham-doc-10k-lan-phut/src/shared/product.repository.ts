import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { KYSELY, type Database } from './db';
import type { PriceChange, ProductPage } from './product';

/**
 * Truy vấn PostgreSQL cho trang sản phẩm. Không biết gì về cache: bản "trước" gọi thẳng, bản "sau" bọc cache bên ngoài.
 * Một câu SQL join 5 bảng (biến thể + giá, ảnh gom bằng json_agg), nên `calls` trong pg_stat_statements = số lần trang chạm DB.
 */
@Injectable()
export class ProductRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async findPage(id: number): Promise<ProductPage | null> {
    const row = await this.db
      .selectFrom('products as p')
      .innerJoin('shop_ratings as s', 's.shop_id', 'p.shop_id')
      .select((eb) => [
        'p.id',
        'p.name',
        'p.description',
        'p.category',
        'p.updated_at',
        's.shop_id',
        's.rating_avg',
        's.rating_count',
        jsonArrayFrom(
          eb
            .selectFrom('product_variants as v')
            .innerJoin('variant_prices as vp', 'vp.variant_id', 'v.id')
            .select(['v.id', 'v.sku', 'v.name', 'v.stock', 'vp.price', 'vp.list_price as listPrice'])
            .whereRef('v.product_id', '=', 'p.id')
            .orderBy('v.id'),
        ).as('variants'),
        jsonArrayFrom(
          eb.selectFrom('product_images as i').select(['i.url', 'i.position']).whereRef('i.product_id', '=', 'p.id').orderBy('i.position'),
        ).as('images'),
      ])
      .where('p.id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      updatedAt: row.updated_at.toISOString(),
      shop: { id: row.shop_id, ratingAvg: row.rating_avg, ratingCount: row.rating_count },
      variants: row.variants,
      images: row.images,
    };
  }

  /** Đổi giá một biến thể và đóng dấu thời gian sản phẩm trong cùng transaction. Trả false nếu biến thể không thuộc sản phẩm. */
  async updatePrice(productId: number, change: PriceChange): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('variant_prices')
        .set({ price: change.price, updated_at: sql`now()` })
        .where('variant_id', '=', change.variantId)
        .where((eb) =>
          eb.exists(eb.selectFrom('product_variants').select('id').where('id', '=', change.variantId).where('product_id', '=', productId)),
        )
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) return false;
      await trx.updateTable('products').set({ updated_at: sql`now()` }).where('id', '=', productId).execute();
      return true;
    });
  }
}
