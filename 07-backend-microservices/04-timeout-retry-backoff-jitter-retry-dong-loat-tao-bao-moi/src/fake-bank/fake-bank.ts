import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import Fastify, { type FastifyInstance } from 'fastify';

export interface BankBehavior {
  /** Số request tối đa mỗi giây; vượt thì trả 503. Đây là toàn bộ mô hình quá tải của lab: không tự sụp, không tự chậm đi. */
  capacityRps: number;
  /** Tỉ lệ request trả 503 trước khi xử lý gì. */
  errorRate: number;
  /** Tỉ lệ request đã ghi giao dịch nhưng trả 503, như phản hồi bị mất trên đường về. */
  lostResponseRate: number;
  /** Lớn hơn 0 thì mọi request trả 429 kèm Retry-After bằng số giây này. */
  retryAfterSeconds: number;
  latencyMs: number;
}

interface Transfer {
  transactionId: string;
  reference: string;
  amountVnd: number;
}

export const DEFAULT_BEHAVIOR: BankBehavior = {
  capacityRps: 100,
  errorRate: 0,
  lostResponseRate: 0,
  retryAfterSeconds: 0,
  latencyMs: 5,
};

/** Đối tác ngân hàng giả: ghi giao dịch, đếm request theo giây, và lỗi theo lệnh. Idempotency-Key là tùy chọn, như hợp đồng cũ. */
export class FakeBank {
  readonly behavior: BankBehavior = { ...DEFAULT_BEHAVIOR };
  readonly transfers: Transfer[] = [];
  private readonly byKey = new Map<string, Transfer>();
  readonly perSecond = new Map<number, { transfers: number; lookups: number; accepted: number; rejected: number }>();
  /** Thời điểm từng lần gọi với cùng reference, để test đo khoảng cách giữa các lần retry. */
  readonly attemptsByReference = new Map<string, number[]>();

  private second(): { transfers: number; lookups: number; accepted: number; rejected: number } {
    const now = Math.floor(Date.now() / 1_000);
    const entry = this.perSecond.get(now) ?? { transfers: 0, lookups: 0, accepted: 0, rejected: 0 };
    this.perSecond.set(now, entry);
    return entry;
  }

  /** Số giao dịch thừa: mỗi lệnh nạp chỉ được tạo đúng một giao dịch. */
  duplicates(): number {
    const references = new Set(this.transfers.map((transfer) => transfer.reference));
    return this.transfers.length - references.size;
  }

  build(): FastifyInstance {
    const app = Fastify({ logger: false });

    app.get('/healthz', () => 'ok');

    app.post<{ Body: { reference: string; amountVnd: number } }>('/transfers', async (request, reply) => {
      const second = this.second();
      second.transfers += 1;
      const { reference, amountVnd } = request.body;
      this.attemptsByReference.set(reference, [...(this.attemptsByReference.get(reference) ?? []), Date.now()]);
      if (this.behavior.retryAfterSeconds > 0) {
        second.rejected += 1;
        return reply.code(429).header('retry-after', this.behavior.retryAfterSeconds).send({ message: 'Chậm lại' });
      }
      if (second.accepted >= this.behavior.capacityRps || Math.random() < this.behavior.errorRate) {
        second.rejected += 1;
        return reply.code(503).send({ message: 'Đối tác quá tải' });
      }
      second.accepted += 1;
      await sleep(this.behavior.latencyMs);
      if (amountVnd <= 0) {
        return reply.code(400).send({ message: 'Số tiền không hợp lệ' });
      }
      const key = request.headers['idempotency-key'];
      const existing = typeof key === 'string' ? this.byKey.get(key) : undefined;
      if (existing) {
        return existing;
      }
      const transfer = { transactionId: randomUUID(), reference, amountVnd };
      this.transfers.push(transfer);
      if (typeof key === 'string') {
        this.byKey.set(key, transfer);
      }
      if (Math.random() < this.behavior.lostResponseRate) {
        return reply.code(503).send({ message: 'Phản hồi bị mất' });
      }
      return transfer;
    });

    app.get<{ Params: { key: string } }>('/transfers/:key', async (request, reply) => {
      this.second().lookups += 1;
      const transfer = this.byKey.get(request.params.key);
      return transfer ?? reply.code(404).send({ message: 'Không có giao dịch' });
    });

    app.post<{ Body: Partial<BankBehavior> }>('/admin/behavior', (request) => Object.assign(this.behavior, request.body));

    app.get('/stats', () => ({
      perSecond: Object.fromEntries(this.perSecond),
      transfers: this.transfers.length,
      duplicates: this.duplicates(),
    }));

    return app;
  }
}
