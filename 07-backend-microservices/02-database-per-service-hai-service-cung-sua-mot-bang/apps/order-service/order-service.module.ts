import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  type DynamicModule,
} from '@nestjs/common';
import { sql, type Generated, type Transaction } from 'kysely';
import { Database } from '../../libs/platform/database';
import { requestContext } from '../../libs/platform/request-context';
import { toPublishedEvent, type OrderSnapshot } from './published-event';

interface OrderingTables {
  orders: {
    id: string;
    shop_id: string;
    address: string;
    delivery_window: string;
    zone_code: string;
    total_vnd: number;
    version: Generated<number>;
    created_at: Generated<Date>;
  };
  order_items: { order_id: string; sku: string; quantity: number };
}

interface CreateOrderBody {
  shopId: string;
  address: string;
  deliveryWindow: string;
  zoneCode: string;
  totalVnd: number;
  items: { sku: string; quantity: number }[];
}

const SNAPSHOT = ['id', 'address', 'delivery_window', 'zone_code', 'version', 'created_at'] as const;

@Injectable()
class OrderService {
  constructor(@Inject(Database) private readonly database: Database<OrderingTables>) {}

  create(body: CreateOrderBody) {
    return this.database.db.transaction().execute(async (trx) => {
      const order = await trx
        .insertInto('orders')
        .values({
          id: randomUUID(),
          shop_id: body.shopId,
          address: body.address,
          delivery_window: body.deliveryWindow,
          zone_code: body.zoneCode,
          total_vnd: body.totalVnd,
        })
        .returning(SNAPSHOT)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('order_items')
        .values(body.items.map((item) => ({ order_id: order.id, sku: item.sku, quantity: item.quantity })))
        .execute();
      await this.publish(trx, 'OrderCreated', order);
      return { orderId: order.id };
    });
  }

  changeAddress(orderId: string, address: string) {
    return this.database.db.transaction().execute(async (trx) => {
      const order = await trx
        .updateTable('orders')
        .set((eb) => ({ address, version: eb('version', '+', 1) }))
        .where('id', '=', orderId)
        .returning(SNAPSHOT)
        .executeTakeFirst();
      if (!order) {
        throw new NotFoundException(`Không có đơn ${orderId}`);
      }
      await this.publish(trx, 'OrderAddressChanged', order);
      return { orderId, version: order.version };
    });
  }

  find(orderId: string) {
    return this.database.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst();
  }

  // [PATTERN] Sự kiện gửi trong cùng transaction với việc ghi đơn: không có đơn mà thiếu sự kiện, không có sự kiện mà
  // thiếu đơn. Làm được vậy vì PGMQ nằm trong cùng PostgreSQL; tách máy chủ thì cần Transactional Outbox (14/03).
  private async publish(
    trx: Transaction<OrderingTables>,
    eventType: 'OrderCreated' | 'OrderAddressChanged',
    order: OrderSnapshot,
  ): Promise<void> {
    const event = toPublishedEvent(eventType, order, requestContext.getStore()?.correlationId);
    await sql`SELECT pgmq.send('order_events', ${JSON.stringify(event)}::jsonb)`.execute(trx);
  }
}

@Controller('orders')
class OrderController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Post()
  create(@Body() body: CreateOrderBody) {
    return this.orders.create(body);
  }

  @Patch(':id/address')
  changeAddress(@Param('id') id: string, @Body() body: { address: string }) {
    return this.orders.changeAddress(id, body.address);
  }

  /** Đường tra cứu lẻ cho trường ngoài bản sao; không dùng để join hàng loạt. */
  @Get(':id')
  async get(@Param('id') id: string) {
    const order = await this.orders.find(id);
    if (!order) {
      throw new NotFoundException(`Không có đơn ${id}`);
    }
    return order;
  }
}

@Module({})
export class OrderServiceModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: OrderServiceModule,
      controllers: [OrderController],
      providers: [OrderService, { provide: Database, useFactory: () => new Database(databaseUrl, 'ordering') }],
    };
  }
}
