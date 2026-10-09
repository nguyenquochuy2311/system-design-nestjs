import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { requireEnv } from './config';
import { CustomersController } from './customers/customers.controller';
import { CustomersRepository } from './customers/customers.repository';
import { createDb, KYSELY, type Database } from './db/database';

/** [PATTERN] Ứng dụng nối bằng DATABASE_URL của role app (chỉ DML); migration dùng chuỗi kết nối khác (role owner). */
@Module({
  controllers: [CustomersController],
  providers: [{ provide: KYSELY, useFactory: () => createDb(requireEnv('DATABASE_URL')) }, CustomersRepository],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
