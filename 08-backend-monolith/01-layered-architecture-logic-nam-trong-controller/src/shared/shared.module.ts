import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createDb, KYSELY, type Database } from './db';
import { MAILER, RecordingMailer } from './mailer';

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

/** Hạ tầng dùng chung cho cả hai bản: kết nối Kysely và mailer ghi lại. */
@Global()
@Module({
  providers: [
    { provide: KYSELY, useFactory: () => createDb() },
    { provide: MAILER, useClass: RecordingMailer },
    DatabaseCloser,
  ],
  exports: [KYSELY, MAILER],
})
export class SharedModule {}
