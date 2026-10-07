import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { KYSELY, type Database } from './db';
import { HOME_DEALS_LIMIT, PAGE_SIZE, type CategoryPage, type HomeDeals, type ProductItem, type ProductPage } from './pages';

const ITEM_COLUMNS = ['p.id', 'p.name', 'p.category', 'p.price', 'p.list_price as listPrice'] as const;

/** Truy vấn PostgreSQL cho ba loại trang và cho bước đặt hàng. Không biết gì về cache; hai bản dùng chung. */
@Injectable()
export class PageRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  findProduct(id: number): Promise<ProductPage | undefined> {
    return this.db.selectFrom('products as p').select(ITEM_COLUMNS).where('p.id', '=', id).executeTakeFirst();
  }

  async findCategoryPage(slug: string, page: number): Promise<CategoryPage> {
    const items: ProductItem[] = await this.db
      .selectFrom('products as p')
      .select(ITEM_COLUMNS)
      .where('p.category', '=', slug)
      .orderBy('p.id')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    return { category: slug, page, items };
  }

  async findHomeDeals(): Promise<HomeDeals> {
    const items: ProductItem[] = await this.db
      .selectFrom('home_deals as d')
      .innerJoin('products as p', 'p.id', 'd.product_id')
      .select(ITEM_COLUMNS)
      .orderBy('d.position')
      .limit(HOME_DEALS_LIMIT)
      .execute();
    return { items };
  }

  /**
   * Tạo đơn với giá `chargedPrice` đã tính; db_price lấy giá trong DB đúng lúc tạo đơn (chỉ để đếm đơn sai giá).
   * chargedPrice = null: tính giá từ DB ngay trong câu INSERT.
   */
  async insertOrder(variant: string, productId: number, chargedPrice: number | null): Promise<{ id: number; chargedPrice: number } | undefined> {
    const { rows } = await sql<{ id: number; charged_price: number }>`
      INSERT INTO orders (variant, product_id, charged_price, db_price)
      SELECT ${variant}, id, coalesce(${chargedPrice}::bigint, price), price FROM products WHERE id = ${productId}
      RETURNING id, charged_price`.execute(this.db);
    return rows[0] && { id: rows[0].id, chargedPrice: rows[0].charged_price };
  }
}

/** Đổi giá bán một sản phẩm trong transaction `trx` (đường ghi admin). Trả false nếu không có sản phẩm. */
export async function setProductPrice(trx: Transaction<Database>, id: number, price: number): Promise<boolean> {
  const res = await trx.updateTable('products').set({ price, price_changed_at: sql`clock_timestamp()` }).where('id', '=', id).executeTakeFirst();
  return res.numUpdatedRows > 0n;
}

/**
 * Áp các khuyến mãi tới giờ bắt đầu hoặc kết thúc tính tới `now` (giờ của tiến trình job, cùng đồng hồ với script đo).
 * SKIP LOCKED để hai tiến trình job không áp cùng một khuyến mãi. Trả id sản phẩm đã đổi giá.
 */
export async function applyDuePromotions(trx: Transaction<Database>, now: Date, limit = 500): Promise<number[]> {
  const starting = await trx
    .selectFrom('promotions')
    .select(['id', 'product_id', 'promo_price'])
    .where('state', '=', 'scheduled')
    .where('starts_at', '<=', now)
    .orderBy('starts_at')
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  const ending = await trx
    .selectFrom('promotions')
    .select(['id', 'product_id'])
    .where('state', '=', 'active')
    .where('ends_at', '<=', now)
    .orderBy('ends_at')
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  for (const p of starting) {
    await trx.updateTable('products').set({ price: p.promo_price, price_changed_at: sql`clock_timestamp()` }).where('id', '=', p.product_id).execute();
  }
  for (const p of ending) {
    await trx.updateTable('products').set({ price: sql`list_price`, price_changed_at: sql`clock_timestamp()` }).where('id', '=', p.product_id).execute();
  }
  if (starting.length) await trx.updateTable('promotions').set({ state: 'active' }).where('id', 'in', starting.map((p) => p.id)).execute();
  if (ending.length) await trx.updateTable('promotions').set({ state: 'ended' }).where('id', 'in', ending.map((p) => p.id)).execute();
  return [...starting, ...ending].map((p) => p.product_id);
}
