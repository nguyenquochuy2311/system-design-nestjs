import { Controller, Get, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createDb, KYSELY, type Database } from './db';
import { PaymentsService } from './payments.service';
import { TransactionContext } from './transaction-context';

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

@Controller('healthz')
class HealthController {
  @Get()
  ok() {
    return { ok: true };
  }
}

/** Hạ tầng và nghiệp vụ dùng chung cho hai bản: Kysely, transaction theo request, service thanh toán. */
@Global()
@Module({
  controllers: [HealthController],
  providers: [{ provide: KYSELY, useFactory: () => createDb() }, TransactionContext, PaymentsService, DatabaseCloser],
  exports: [KYSELY, TransactionContext, PaymentsService],
})
export class SharedModule {}
