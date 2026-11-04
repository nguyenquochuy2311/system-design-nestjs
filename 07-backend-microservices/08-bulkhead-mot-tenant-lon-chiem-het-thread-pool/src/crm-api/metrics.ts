import { Counter, Histogram, Registry } from 'prom-client';

export class CrmMetrics {
  readonly registry = new Registry();

  readonly waitSeconds = new Histogram({
    name: 'bulkhead_wait_seconds',
    help: 'Thời gian chờ chỗ trong khoang',
    labelNames: ['compartment'],
    buckets: [0.001, 0.005, 0.02, 0.1, 0.5, 2],
    registers: [this.registry],
  });

  readonly rejected = new Counter({
    name: 'bulkhead_rejected_total',
    help: 'Số request bị từ chối vì khoang của tenant đã đầy',
    labelNames: ['compartment'],
    registers: [this.registry],
  });
}
