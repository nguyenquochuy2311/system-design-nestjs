import { Counter, Gauge, Registry } from 'prom-client';

/** Mỗi app một registry riêng, để nhiều app chạy chung tiến trình test không dùng chung bộ đếm. */
export class CheckoutMetrics {
  readonly registry = new Registry();

  /** 0 là Closed, 1 là Half-Open, 2 là Open. */
  readonly state = new Gauge({
    name: 'circuit_breaker_state',
    help: 'Trạng thái cầu dao tới promotion: 0 Closed, 1 Half-Open, 2 Open',
    registers: [this.registry],
  });

  readonly opened = new Counter({
    name: 'circuit_breaker_opened_total',
    help: 'Số lần cầu dao tới promotion mở',
    registers: [this.registry],
  });

  readonly fallbacks = new Counter({
    name: 'circuit_breaker_fallback_total',
    help: 'Số lần checkout dùng phương án không giảm giá',
    registers: [this.registry],
  });
}
