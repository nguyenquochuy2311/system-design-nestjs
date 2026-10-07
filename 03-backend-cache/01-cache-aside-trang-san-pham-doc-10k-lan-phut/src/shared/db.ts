import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

// bigint (INT8: giá tính bằng đồng) và numeric (điểm đánh giá) trả về dạng number; mọi giá trị nằm dưới 2^53.
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export interface Database {
  shop_ratings: { shop_id: number; rating_avg: number; rating_count: number };
  products: {
    id: Generated<number>;
    shop_id: number;
    name: string;
    description: string;
    category: string;
    updated_at: Generated<Date>;
  };
  product_variants: { id: Generated<number>; product_id: number; sku: string; name: string; stock: number };
  variant_prices: { variant_id: number; price: number; list_price: number; updated_at: Generated<Date> };
  product_images: { id: Generated<number>; product_id: number; url: string; position: number };
}

/** Token DI của Kysely: interface của TypeScript không tồn tại lúc chạy nên NestJS cần một token thật. */
export const KYSELY = Symbol('KYSELY');

export interface DbOptions {
  /** Gọi cho mỗi câu SQL; test dùng để đếm số lần một request chạm DB. */
  onQuery?: (sql: string) => void;
  max?: number;
}

export function createDb(connectionString: string, opts: DbOptions = {}): Kysely<Database> {
  const onQuery = opts.onQuery;
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: opts.max ?? 10 }) }),
    log: onQuery
      ? (event) => {
          if (event.level === 'query') onQuery(event.query.sql);
        }
      : undefined,
  });
}
