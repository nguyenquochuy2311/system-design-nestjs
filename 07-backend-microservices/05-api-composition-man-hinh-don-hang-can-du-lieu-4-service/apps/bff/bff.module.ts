import { Controller, Get, Header, Headers, Inject, Module, Param, Query, type DynamicModule } from '@nestjs/common';
import { BffMetrics } from './metrics';
import { OrderDetailComposer, SOURCE_URLS, type Viewer } from './order-detail.composer';
import type { SourceUrls } from './source-client';

// Lab không dựng xác thực: danh tính đọc từ header, coi như gateway đã xác thực (xem scope 19).
const viewerOf = (userId: string, role: string): Viewer => ({ userId, role: role === 'support' ? 'support' : 'customer' });

@Controller()
class OrderDetailController {
  constructor(
    @Inject(OrderDetailComposer) private readonly composer: OrderDetailComposer,
    @Inject(BffMetrics) private readonly metrics: BffMetrics,
  ) {}

  @Get('order-details')
  list(
    @Query('customerId') customerId: string,
    @Headers('x-user-id') userId: string,
    @Headers('x-user-role') role: string,
  ) {
    return this.composer.list(customerId, viewerOf(userId, role));
  }

  @Get('order-details/:id')
  detail(@Param('id') id: string, @Headers('x-user-id') userId: string, @Headers('x-user-role') role: string) {
    return this.composer.detail(id, viewerOf(userId, role));
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  scrape() {
    return this.metrics.registry.metrics();
  }
}

@Module({})
export class BffModule {
  static register(urls: SourceUrls): DynamicModule {
    return {
      module: BffModule,
      controllers: [OrderDetailController],
      providers: [
        OrderDetailComposer,
        { provide: BffMetrics, useValue: new BffMetrics() },
        { provide: SOURCE_URLS, useValue: urls },
      ],
    };
  }
}
