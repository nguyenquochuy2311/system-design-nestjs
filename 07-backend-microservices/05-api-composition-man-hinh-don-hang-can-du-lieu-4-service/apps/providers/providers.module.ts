import { setTimeout as sleep } from 'node:timers/promises';
import {
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
  type DynamicModule,
  type Type,
} from '@nestjs/common';
import { Database } from '../../libs/platform/database';

/** Test và lượt đo chỉnh được độ trễ và lỗi của từng provider, không cần sửa code của nó. */
export interface ProviderBehavior {
  delayMs: number;
  failing: boolean;
  requests: number;
}

const BEHAVIOR = Symbol('BEHAVIOR');

abstract class Provider {
  constructor(
    protected readonly db: Database,
    private readonly behavior: ProviderBehavior,
  ) {}

  /** Một request tới provider: đếm, chờ độ trễ giả định, rồi mới làm việc thật. */
  protected async serve<T>(work: () => Promise<T>): Promise<T> {
    this.behavior.requests += 1;
    await sleep(this.behavior.delayMs);
    if (this.behavior.failing) {
      throw new ServiceUnavailableException('Provider đang lỗi');
    }
    return work();
  }

  protected async one(query: string, id: string): Promise<unknown> {
    const { rows } = await this.db.query(query, [id]);
    if (!rows[0]) {
      throw new NotFoundException(`Không có ${id}`);
    }
    return rows[0];
  }
}

@Controller('orders')
class OrderProvider extends Provider {
  constructor(@Inject(Database) db: Database, @Inject(BEHAVIOR) behavior: ProviderBehavior) {
    super(db, behavior);
  }

  @Get()
  list(@Query('customerId') customerId: string) {
    return this.serve(async () => {
      const { rows } = await this.db.query(
        'SELECT id, customer_id, total_vnd FROM ordering.orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20',
        [customerId],
      );
      return rows;
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.serve(() => this.one('SELECT id, customer_id, total_vnd FROM ordering.orders WHERE id = $1', id));
  }
}

@Controller('payments')
class PaymentProvider extends Provider {
  constructor(@Inject(Database) db: Database, @Inject(BEHAVIOR) behavior: ProviderBehavior) {
    super(db, behavior);
  }

  /** [PATTERN] Endpoint lô: một lời gọi cho cả màn hình danh sách. */
  @Get()
  batch(@Query('orderIds') orderIds: string) {
    return this.serve(async () => {
      const { rows } = await this.db.query('SELECT order_id, status FROM payment.payments WHERE order_id = ANY($1)', [
        orderIds.split(','),
      ]);
      return rows;
    });
  }

  @Get(':orderId')
  get(@Param('orderId') orderId: string) {
    return this.serve(() => this.one('SELECT order_id, status FROM payment.payments WHERE order_id = $1', orderId));
  }
}

@Controller('shipments')
class ShippingProvider extends Provider {
  constructor(@Inject(Database) db: Database, @Inject(BEHAVIOR) behavior: ProviderBehavior) {
    super(db, behavior);
  }

  @Get()
  batch(@Query('orderIds') orderIds: string) {
    return this.serve(async () => {
      const { rows } = await this.db.query(
        'SELECT order_id, status, carrier FROM shipping.shipments WHERE order_id = ANY($1)',
        [orderIds.split(',')],
      );
      return rows;
    });
  }

  @Get(':orderId')
  get(@Param('orderId') orderId: string) {
    return this.serve(() => this.one('SELECT order_id, status, carrier FROM shipping.shipments WHERE order_id = $1', orderId));
  }
}

@Controller('customers')
class CustomerProvider extends Provider {
  constructor(@Inject(Database) db: Database, @Inject(BEHAVIOR) behavior: ProviderBehavior) {
    super(db, behavior);
  }

  @Get()
  batch(@Query('ids') ids: string) {
    return this.serve(async () => {
      const { rows } = await this.db.query('SELECT id, name, tier FROM customer.customers WHERE id = ANY($1)', [ids.split(',')]);
      return rows;
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.serve(() => this.one('SELECT id, name, tier FROM customer.customers WHERE id = $1', id));
  }
}

const CONTROLLERS = {
  'order-service': OrderProvider,
  'payment-service': PaymentProvider,
  'shipping-service': ShippingProvider,
  'customer-service': CustomerProvider,
} as const satisfies Record<string, Type<unknown>>;

export type ProviderName = keyof typeof CONTROLLERS;

export const isProviderName = (name: string): name is ProviderName => name in CONTROLLERS;

@Module({})
export class ProviderModule {
  static register(name: ProviderName, databaseUrl: string, behavior: ProviderBehavior): DynamicModule {
    return {
      module: ProviderModule,
      controllers: [CONTROLLERS[name]],
      providers: [
        { provide: BEHAVIOR, useValue: behavior },
        { provide: Database, useFactory: () => new Database(databaseUrl) },
      ],
    };
  }
}
