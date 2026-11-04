import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
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

// Hai service cùng đọc và ghi các bảng trong schema `shared`. Kiểu dưới đây là bản chép tay của cấu trúc bảng: đổi cột ở
// một bên thì không công cụ nào báo cho bên kia, và lỗi chỉ lộ lúc chạy.
interface SharedTables {
  orders: {
    id: string;
    shop_id: string;
    address: string;
    delivery_window: string;
    zone_code: string;
    total_vnd: number;
    status: string;
  };
  order_items: { order_id: string; sku: string; quantity: number };
  order_status_history: { order_id: string; status: string };
}

interface CreateOrderBody {
  shopId: string;
  address: string;
  deliveryWindow: string;
  zoneCode: string;
  totalVnd: number;
  items: { sku: string; quantity: number }[];
}

@Controller('orders')
class OrderController {
  constructor(@Inject(Database) private readonly database: Database<SharedTables>) {}

  @Post()
  create(@Body() body: CreateOrderBody) {
    const id = randomUUID();
    return this.database.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('orders')
        .values({
          id,
          shop_id: body.shopId,
          address: body.address,
          delivery_window: body.deliveryWindow,
          zone_code: body.zoneCode,
          total_vnd: body.totalVnd,
          status: 'NEW',
        })
        .execute();
      await trx
        .insertInto('order_items')
        .values(body.items.map((item) => ({ order_id: id, sku: item.sku, quantity: item.quantity })))
        .execute();
      await trx.insertInto('order_status_history').values({ order_id: id, status: 'NEW' }).execute();
      return { orderId: id };
    });
  }
}

@Controller()
class ShippingController {
  constructor(@Inject(Database) private readonly database: Database<SharedTables>) {}

  /** Đọc thẳng bảng của order-service: không có API hay hợp đồng nào ở giữa. */
  @Get('shipments/:orderId')
  async shipment(@Param('orderId') orderId: string) {
    const row = await this.database.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst();
    if (!row) {
      throw new NotFoundException(`Không có đơn ${orderId}`);
    }
    return row;
  }

  @Post('reports/delivery-success')
  @HttpCode(200)
  report(@Query('mode') mode: string) {
    if (mode !== 'plain' && mode !== 'lock') {
      throw new BadRequestException('mode phải là plain hoặc lock');
    }
    return this.database.db.transaction().execute(async (trx) => {
      // Chế độ lock: báo cáo muốn số khớp nhau giữa các nhóm nên giữ bảng đứng yên, và chặn luôn việc ghi đơn mới.
      if (mode === 'lock') {
        await sql`LOCK TABLE shared.orders IN SHARE MODE`.execute(trx);
      }
      const { rows } = await sql`
        WITH attempts AS (
          SELECT o.zone_code, o.created_at, a.outcome
          FROM shared.orders o JOIN shared.delivery_attempts a ON a.order_id = o.id
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
export class TruocOrderModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: TruocOrderModule,
      controllers: [OrderController],
      providers: [{ provide: Database, useFactory: () => new Database(databaseUrl, 'shared') }],
    };
  }
}

@Module({})
export class TruocShippingModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: TruocShippingModule,
      controllers: [ShippingController],
      providers: [{ provide: Database, useFactory: () => new Database(databaseUrl, 'shared') }],
    };
  }
}
