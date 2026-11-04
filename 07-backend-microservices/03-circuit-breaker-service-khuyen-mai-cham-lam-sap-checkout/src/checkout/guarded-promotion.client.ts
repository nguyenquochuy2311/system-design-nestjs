import CircuitBreaker from 'opossum';
import type { Pool } from 'undici';
import { logEvent } from '../shared/log';
import type { CheckoutMetrics } from './metrics';
import { InvalidPromoCodeError, requestDiscount, type Cart, type Discount, type PromotionClient } from './promotion.client';

export interface BreakerSettings {
  timeoutMs: number;
  errorThresholdPercentage: number;
  volumeThreshold: number;
  rollingCountTimeout: number;
  resetTimeout: number;
}

export const DEFAULT_BREAKER: BreakerSettings = {
  timeoutMs: 2_000,
  errorThresholdPercentage: 50,
  volumeThreshold: 10,
  rollingCountTimeout: 10_000,
  resetTimeout: 30_000,
};

const NO_DISCOUNT: Discount = { discountVnd: 0, promotionUnavailable: true };

/** Bản "sau": mỗi phụ thuộc một cầu dao, nên lỗi của promotion không làm mở cầu dao của phụ thuộc khác. */
export class GuardedPromotionClient implements PromotionClient {
  private readonly breaker: CircuitBreaker<[Cart], Discount>;

  constructor(pool: Pool, settings: BreakerSettings, metrics: CheckoutMetrics) {
    // [PATTERN] Ngưỡng theo tỷ lệ lỗi kèm số lời gọi tối thiểu, để vài lỗi lúc tải thấp không làm mở cầu dao.
    this.breaker = new CircuitBreaker((cart: Cart) => requestDiscount(pool, cart, settings.timeoutMs), {
      timeout: false,
      errorThresholdPercentage: settings.errorThresholdPercentage,
      volumeThreshold: settings.volumeThreshold,
      rollingCountTimeout: settings.rollingCountTimeout,
      rollingCountBuckets: 10,
      resetTimeout: settings.resetTimeout,
      // [PATTERN] Lỗi do request sai không chứng tỏ promotion hỏng, nên không tính vào ngưỡng.
      errorFilter: (error: unknown) => error instanceof InvalidPromoCodeError,
    });
    // [PATTERN] Fallback rẻ và cục bộ: không gọi phụ thuộc nào khác, và gắn cờ để giao diện báo cho khách.
    this.breaker.fallback(() => NO_DISCOUNT);
    this.breaker.on('fallback', () => metrics.fallbacks.inc());
    // Mọi lần đổi trạng thái đều ghi log và đo: cầu dao mở là tín hiệu vận hành, không được im lặng.
    const recordState = (state: string, value: number) => () => {
      metrics.state.set(value);
      logEvent({ service: 'checkout', event: 'circuit_state_changed', state });
    };
    this.breaker.on('close', recordState('close', 0));
    this.breaker.on('halfOpen', recordState('halfOpen', 1));
    this.breaker.on('open', recordState('open', 2));
    this.breaker.on('open', () => metrics.opened.inc());
  }

  calculate(cart: Cart): Promise<Discount> {
    return this.breaker.fire(cart);
  }

  shutdown(): void {
    this.breaker.shutdown();
  }
}
