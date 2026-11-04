import { Counter, Gauge, Registry } from 'prom-client';

/** Retry che lỗi khỏi dashboard, nên phải đếm riêng theo nguyên nhân để thấy đối tác đang yếu. */
export class WalletMetrics {
  readonly registry = new Registry();

  readonly retries = new Counter({
    name: 'bank_retries_total',
    help: 'Số lần retry lời gọi đối tác, theo nguyên nhân',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  readonly budgetExhausted = new Counter({
    name: 'bank_retry_budget_exhausted_total',
    help: 'Số lần muốn retry nhưng đã hết ngân sách',
    registers: [this.registry],
  });

  readonly topups = new Counter({
    name: 'wallet_topups_total',
    help: 'Kết quả lệnh nạp: completed, pending, rejected, failed',
    labelNames: ['result'],
    registers: [this.registry],
  });

  /** Kết cục cuối của lệnh "đang xử lý": phải nhìn số này, không chỉ nhìn tỷ lệ trả lời nhanh. */
  readonly reconciled = new Counter({
    name: 'wallet_reconciled_total',
    help: 'Kết cục của lệnh đi qua đối soát: COMPLETED hoặc FAILED',
    labelNames: ['status'],
    registers: [this.registry],
  });

  readonly reconcileDepth = new Gauge({
    name: 'wallet_reconcile_queue_depth',
    help: 'Số lệnh đang chờ đối soát',
    registers: [this.registry],
  });
}
