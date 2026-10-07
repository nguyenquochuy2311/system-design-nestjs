import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

// bigint (INT8: giá tính bằng đồng, id của outbox) trả về dạng number; mọi giá trị nằm dưới 2^53.
pg.types.setTypeParser(20, (value) => Number(value));

export interface Database {
  products: {
    id: Generated<number>;
    category: string;
    name: string;
    list_price: number;
    price: number;
    price_changed_at: Generated<Date>;
  };
  home_deals: { position: number; product_id: number };
  promotions: {
    id: Generated<number>;
    product_id: number;
    promo_price: number;
    starts_at: Date;
    ends_at: Date;
    state: Generated<'scheduled' | 'active' | 'ended'>;
  };
  price_import: { id: Generated<number>; product_id: number; new_price: number; applied_at: Date | null };
  price_outbox: {
    id: Generated<number>;
    product_id: number;
    source: 'admin' | 'csv' | 'promo';
    created_at: Generated<Date>;
    processed_at: Date | null;
    keys_targeted: number | null;
  };
  orders: {
    id: Generated<number>;
    variant: string;
    product_id: number;
    charged_price: number;
    db_price: number;
    created_at: Generated<Date>;
  };
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
