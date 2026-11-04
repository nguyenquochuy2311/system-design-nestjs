import { Counter, Histogram, Registry } from 'prom-client';

export class BffMetrics {
  readonly registry = new Registry();

  /** Thấy nguồn nào đang kéo dài p95 màn hình. */
  readonly sourceDuration = new Histogram({
    name: 'bff_source_duration_seconds',
    help: 'Thời gian gọi từng nguồn',
    labelNames: ['source'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  readonly partialResponses = new Counter({
    name: 'bff_partial_responses_total',
    help: 'Số phản hồi một phần, theo nguồn thiếu',
    labelNames: ['source'],
    registers: [this.registry],
  });
}
