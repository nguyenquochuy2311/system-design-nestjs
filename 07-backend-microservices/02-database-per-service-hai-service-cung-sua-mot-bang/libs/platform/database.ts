import type { OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Tiền và id lưu bằng bigint; pg mặc định trả chuỗi. Giá trị của lab nằm xa giới hạn an toàn của Number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

/** Kết nối của một service: role riêng, schema riêng, kiểu riêng. Nest tự đóng pool khi app tắt. */
export class Database<Tables> implements OnApplicationShutdown {
  private readonly root: Kysely<Tables>;
  readonly db: Kysely<Tables>;

  constructor(connectionString: string, schema: string, max = 10) {
    this.root = new Kysely<Tables>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
    });
    this.db = this.root.withSchema(schema);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.root.destroy();
  }
}
