import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

// bigint (INT8) trả về dạng chuỗi để không mất chữ số.
export interface Database {
  customers: {
    id: Generated<string>;
    name: string;
    email: string;
    created_at: Generated<Date>;
  };
}

/** Token DI của Kysely: interface TypeScript không tồn tại lúc chạy (nhật ký 08/01 điểm 1: luôn @Inject tường minh). */
export const KYSELY = Symbol('KYSELY');

export function createDb<T = Database>(connectionString: string, max = 5): Kysely<T> {
  return new Kysely<T>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }) });
}
