import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { KYSELY, type Database } from '../db/database';

export interface Customer {
  id: string;
  name: string;
  email: string;
}

/** Truy cập bảng customers bằng kết nối của role ứng dụng: chỉ cần SELECT/INSERT/UPDATE/DELETE. */
@Injectable()
export class CustomersRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  create(name: string, email: string): Promise<Customer> {
    return this.db.insertInto('customers').values({ name, email }).returning(['id', 'name', 'email']).executeTakeFirstOrThrow();
  }

  findById(id: string): Promise<Customer | undefined> {
    return this.db.selectFrom('customers').select(['id', 'name', 'email']).where('id', '=', id).executeTakeFirst();
  }

  async rename(id: string, name: string): Promise<Customer | undefined> {
    return this.db.updateTable('customers').set({ name }).where('id', '=', id).returning(['id', 'name', 'email']).executeTakeFirst();
  }

  async remove(id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('customers').where('id', '=', id).executeTakeFirst();
    return r.numDeletedRows > 0n;
  }

  /** Role và phiên bản server mà ứng dụng thật sự đang nối tới (bắt lỗi nối nhầm PostgreSQL cài sẵn trên máy). */
  async whoAmI(): Promise<{ role: string; serverVersion: string }> {
    const r = await sql<{ role: string; v: string }>`SELECT current_user AS role, current_setting('server_version') AS v`.execute(this.db);
    return { role: r.rows[0]?.role ?? '?', serverVersion: r.rows[0]?.v ?? '?' };
  }
}
