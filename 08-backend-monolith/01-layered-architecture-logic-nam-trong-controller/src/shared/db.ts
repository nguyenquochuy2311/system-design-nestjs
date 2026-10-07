import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

// bigint (INT8) của Postgres trả về dạng number: tiền tính bằng đồng và id đều nằm dưới 2^53.
pg.types.setTypeParser(20, (value) => Number(value));

export interface Database {
  customers: {
    id: Generated<number>;
    code: string;
    name: string;
    email: string;
    tier: string;
    credit_limit: number;
  };
  products: { id: Generated<number>; sku: string; name: string; unit_price: number; is_promo: Generated<boolean> };
  orders: {
    id: Generated<number>;
    customer_id: number;
    channel: string;
    external_ref: string | null;
    subtotal: number;
    discount: number;
    total: number;
    status: Generated<string>;
    created_at: Generated<Date>;
  };
  order_items: {
    id: Generated<number>;
    order_id: number;
    product_id: number;
    quantity: number;
    unit_price: number;
    line_total: number;
  };
}

/** Token DI của Kysely; interface của TypeScript không tồn tại lúc chạy nên NestJS cần một token thật. */
export const KYSELY = Symbol('KYSELY');
export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:55432/distribution';

export interface DbOptions {
  connectionString?: string;
  /** Gọi cho mỗi câu SQL, dùng để đếm số câu mỗi request trong test. */
  onQuery?: (sql: string) => void;
}

export function createDb(opts: DbOptions = {}): Kysely<Database> {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const onQuery = opts.onQuery;
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
    log: onQuery
      ? (event) => {
          if (event.level === 'query') onQuery(event.query.sql);
        }
      : undefined,
  });
}
