import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  UnprocessableEntityException,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DEFAULT_BREAKER, GuardedPromotionClient, type BreakerSettings } from './guarded-promotion.client';
import { CheckoutMetrics } from './metrics';
import {
  DirectPromotionClient,
  InvalidPromoCodeError,
  openPromotionPool,
  PROMOTION_CLIENT,
  type Cart,
  type PromotionClient,
} from './promotion.client';

const TRUOC_TIMEOUT_MS = 30_000;

export interface CheckoutConfig {
  mode: 'truoc' | 'sau';
  promotionUrl: string;
  poolSize: number;
  truocTimeoutMs?: number;
  breaker?: Partial<BreakerSettings>;
}

@Injectable()
class CheckoutService {
  constructor(@Inject(PROMOTION_CLIENT) private readonly promotion: PromotionClient) {}

  async checkout(cart: Cart) {
    if (!cart.cartId || !Number.isInteger(cart.subtotalVnd) || cart.subtotalVnd <= 0) {
      throw new BadRequestException('Giỏ hàng không hợp lệ');
    }
    try {
      const { discountVnd, promotionUnavailable } = await this.promotion.calculate(cart);
      return { orderId: randomUUID(), totalVnd: cart.subtotalVnd - discountVnd, discountVnd, promotionUnavailable };
    } catch (error) {
      if (error instanceof InvalidPromoCodeError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}

@Controller()
class CheckoutController {
  constructor(
    @Inject(CheckoutService) private readonly service: CheckoutService,
    @Inject(CheckoutMetrics) private readonly metrics: CheckoutMetrics,
  ) {}

  @Post('checkout')
  @HttpCode(200)
  checkout(@Body() cart: Cart) {
    return this.service.checkout(cart);
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  scrape() {
    return this.metrics.registry.metrics();
  }
}

class PromotionClientLifecycle implements OnApplicationShutdown {
  constructor(private readonly close: () => Promise<void>) {}

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }
}

@Module({})
export class CheckoutModule {
  static register(config: CheckoutConfig): DynamicModule {
    const pool = openPromotionPool(config.promotionUrl, config.poolSize);
    const metrics = new CheckoutMetrics();
    const guarded =
      config.mode === 'sau'
        ? new GuardedPromotionClient(pool, { ...DEFAULT_BREAKER, ...config.breaker }, metrics)
        : undefined;
    return {
      module: CheckoutModule,
      controllers: [CheckoutController],
      providers: [
        CheckoutService,
        { provide: CheckoutMetrics, useValue: metrics },
        {
          provide: PROMOTION_CLIENT,
          useValue: guarded ?? new DirectPromotionClient(pool, config.truocTimeoutMs ?? TRUOC_TIMEOUT_MS),
        },
        {
          provide: PromotionClientLifecycle,
          useValue: new PromotionClientLifecycle(async () => {
            guarded?.shutdown();
            await pool.destroy();
          }),
        },
      ],
    };
  }
}
