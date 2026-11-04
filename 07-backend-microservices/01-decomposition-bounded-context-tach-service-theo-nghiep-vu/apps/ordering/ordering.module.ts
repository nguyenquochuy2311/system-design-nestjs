import { Body, Controller, Inject, Module, Post, type DynamicModule } from '@nestjs/common';
import { Database } from '../../libs/platform/database';
import { CATALOG_EVENT_POLL_MS, CatalogEventConsumer } from './catalog-event.consumer';
import { OrderRepository } from './order.repository';
import { PlaceOrderService, type PlaceOrderCommand } from './place-order.service';
import { InventoryClient, PaymentClient, UPSTREAM_URLS, type UpstreamUrls } from './upstream-clients';

export interface OrderingConfig extends UpstreamUrls {
  databaseUrl: string;
  catalogEventPollMs: number;
}

@Controller('orders')
class OrderController {
  constructor(@Inject(PlaceOrderService) private readonly placeOrder: PlaceOrderService) {}

  @Post()
  place(@Body() body: PlaceOrderCommand) {
    return this.placeOrder.execute(body);
  }
}

@Module({})
export class OrderingModule {
  static register(config: OrderingConfig): DynamicModule {
    return {
      module: OrderingModule,
      controllers: [OrderController],
      providers: [
        PlaceOrderService,
        OrderRepository,
        InventoryClient,
        PaymentClient,
        CatalogEventConsumer,
        { provide: Database, useFactory: () => new Database(config.databaseUrl) },
        { provide: CATALOG_EVENT_POLL_MS, useValue: config.catalogEventPollMs },
        { provide: UPSTREAM_URLS, useValue: { inventoryUrl: config.inventoryUrl, paymentUrl: config.paymentUrl } },
      ],
    };
  }
}
