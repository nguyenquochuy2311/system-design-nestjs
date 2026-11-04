import { BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Module, Post, type DynamicModule } from '@nestjs/common';
import { Counter, Registry } from 'prom-client';

const PROMO_CODES: Record<string, number> = { TET10: 10 };

class PromotionMetrics {
  readonly registry = new Registry();
  readonly requests = new Counter({
    name: 'promotion_requests_total',
    help: 'Số lời gọi tính giảm giá tới được promotion',
    registers: [this.registry],
  });
}

// Service của đội khác: bài không sửa code ở đây. Sự cố chậm được tạo ở tầng mạng bằng Toxiproxy.
@Controller()
class PromotionController {
  constructor(@Inject(PromotionMetrics) private readonly metrics: PromotionMetrics) {}

  @Post('discounts')
  @HttpCode(200)
  calculate(@Body() body: { subtotalVnd: number; promoCode?: string }) {
    this.metrics.requests.inc();
    if (!body.promoCode) {
      return { discountVnd: 0 };
    }
    const percentOff = PROMO_CODES[body.promoCode];
    if (percentOff === undefined) {
      throw new BadRequestException(`Mã ${body.promoCode} không hợp lệ`);
    }
    return { discountVnd: Math.floor((body.subtotalVnd * percentOff) / 100) };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  scrape() {
    return this.metrics.registry.metrics();
  }
}

@Module({})
export class PromotionModule {
  static register(): DynamicModule {
    return {
      module: PromotionModule,
      controllers: [PromotionController],
      providers: [{ provide: PromotionMetrics, useValue: new PromotionMetrics() }],
    };
  }
}
