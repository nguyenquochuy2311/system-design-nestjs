import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';
import { recordQuery } from './query-counter';

export interface Database {
  customers: { id: Generated<number>; name: string; email: string };
  orders: {
    id: Generated<number>;
    customer_id: number;
    status: string;
    total_cents: number;
    created_at: Generated<Date>;
  };
  order_items: {
    id: Generated<number>;
    order_id: number;
    product_name: string;
    quantity: number;
    price_cents: number;
  };
  shipments: { id: Generated<number>; order_id: number; status: string; carrier: string };
}

export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:55432/shop';

export function createDb(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
    // Mọi câu SQL đi qua đây để bộ đếm truy vấn thấy được (kể cả khi ORM "giấu" chúng).
    log: (event) => {
      if (event.level === 'query') recordQuery(event.query.sql);
    },
  });
}
