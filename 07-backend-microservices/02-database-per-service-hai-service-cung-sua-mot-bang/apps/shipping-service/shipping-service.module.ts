import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  type DynamicModule,
} from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../libs/platform/database';
import { OrderEventConsumer } from './order-event.consumer';
import { SHIPPING_CONFIG, type ShippingConfig, type ShippingTables } from './shipping-config';

@Controller()
class ShippingController {
  constructor(@Inject(Database) private readonly database: Database<ShippingTables>) {}

  @Get('shipments/:orderId')
  async shipment(@Param('orderId') orderId: string) {
    const row = await this.database.db
      .selectFrom('shipment_orders')
      .selectAll()
      .where('order_id', '=', orderId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException(`Chưa có bản sao của đơn ${orderId}`);
    }
    return row;
  }

  /** Cùng câu báo cáo với bản "trước", nhưng chỉ chạm bảng của shipping. */
  @Post('reports/delivery-success')
  @HttpCode(200)
  report(@Query('mode') mode: string) {
    if (mode !== 'plain' && mode !== 'lock') {
      throw new BadRequestException('mode phải là plain hoặc lock');
    }
    return this.database.db.transaction().execute(async (trx) => {
      if (mode === 'lock') {
        await sql`LOCK TABLE shipping.shipment_orders IN SHARE MODE`.execute(trx);
      }
      const { rows } = await sql`
        WITH attempts AS (
          SELECT o.zone_code, o.created_at, a.outcome
          FROM shipping.shipment_orders o JOIN shipping.delivery_attempts a ON a.order_id = o.order_id
        )
        SELECT x.zone_code, count(DISTINCT x.created_at) AS deliveries,
          count(*) FILTER (WHERE y.outcome = 'DELIVERED') AS delivered_nearby, count(*) AS nearby
        FROM attempts x
        JOIN attempts y ON y.zone_code = x.zone_code
          AND y.created_at BETWEEN x.created_at - interval '1 hour' AND x.created_at
        GROUP BY x.zone_code`.execute(trx);
      return { zones: rows.length };
    });
  }
}

@Module({})
export class ShippingServiceModule {
  static register(config: ShippingConfig): DynamicModule {
    return {
      module: ShippingServiceModule,
      controllers: [ShippingController],
      providers: [
        OrderEventConsumer,
        { provide: SHIPPING_CONFIG, useValue: config },
        { provide: Database, useFactory: () => new Database(config.databaseUrl, 'shipping') },
      ],
    };
  }
}
