import { randomUUID } from 'node:crypto';
import { Body, Controller, Inject, Module, Post, type DynamicModule } from '@nestjs/common';
import { Database } from '../../libs/platform/database';

@Controller('charges')
class ChargeController {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Chỉ cần mã đơn và số tiền: Payment không đọc bảng đơn hàng, cũng không biết đơn có những gì. */
  @Post()
  async charge(@Body() body: { orderId: string; amountVnd: number }) {
    const transactionId = randomUUID();
    await this.db.query(
      "INSERT INTO payment.transactions (id, order_id, amount_vnd, status) VALUES ($1, $2, $3, 'CAPTURED')",
      [transactionId, body.orderId, body.amountVnd],
    );
    return { transactionId, status: 'CAPTURED' };
  }
}

@Module({})
export class PaymentModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: PaymentModule,
      controllers: [ChargeController],
      providers: [{ provide: Database, useFactory: () => new Database(databaseUrl) }],
    };
  }
}
