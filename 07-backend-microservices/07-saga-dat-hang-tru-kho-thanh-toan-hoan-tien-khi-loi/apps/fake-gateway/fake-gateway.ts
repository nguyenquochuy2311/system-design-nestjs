import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import Fastify, { type FastifyInstance } from 'fastify';

export type ChargeStatus = 'CAPTURED' | 'DECLINED' | 'REFUNDED' | 'VOIDED';

export interface GatewayBehavior {
  declineRate: number;
  /** Tỉ lệ lần trừ tiền đầu tiên treo quá thời gian chờ của khách. */
  timeoutRate: number;
  /** Trong số lần treo, tỉ lệ thực ra đã trừ tiền. Phần còn lại chưa trừ gì. Đây chính là "chưa biết kết quả". */
  timeoutChargedRatio: number;
  latencyMs: number;
  stallMs: number;
}

// Kết quả tính từ key, nên hai bản nhận cùng tỉ lệ và gửi lại cùng key luôn cho cùng kết quả.
const fraction = (key: string) => parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16) / 2 ** 32;

/** Cổng thanh toán bên ngoài: có Idempotency-Key, API tra cứu và hủy; không tham gia transaction của ai. */
export class FakeGateway {
  readonly behavior: GatewayBehavior = {
    declineRate: 0,
    timeoutRate: 0,
    timeoutChargedRatio: 0.5,
    latencyMs: 20,
    stallMs: 3_000,
  };
  readonly charges = new Map<string, ChargeStatus>();
  private readonly stalled = new Set<string>();

  build(): FastifyInstance {
    const app = Fastify({ logger: false });
    app.get('/healthz', () => 'ok');

    app.post<{ Body: { amountVnd: number } }>('/charges', async (request, reply) => {
      const key = String(request.headers['idempotency-key']);
      const existing = this.charges.get(key);
      await sleep(this.behavior.latencyMs);
      if (existing) {
        return reply.code(existing === 'CAPTURED' ? 200 : 402).send({ status: existing });
      }
      const { declineRate, timeoutRate, timeoutChargedRatio, stallMs } = this.behavior;
      const roll = fraction(key);
      if (roll < declineRate) {
        this.charges.set(key, 'DECLINED');
        return reply.code(402).send({ status: 'DECLINED' });
      }
      if (roll < declineRate + timeoutRate && !this.stalled.has(key)) {
        this.stalled.add(key);
        if (fraction(`${key}:charged`) < timeoutChargedRatio) {
          this.charges.set(key, 'CAPTURED');
        }
        await sleep(stallMs);
        return reply.code(504).send({ status: 'STALLED' });
      }
      this.charges.set(key, 'CAPTURED');
      return { status: 'CAPTURED' };
    });

    app.get<{ Params: { key: string } }>('/charges/:key', (request, reply) => {
      const status = this.charges.get(request.params.key);
      return status ? { status } : reply.code(404).send({ message: 'Không có giao dịch' });
    });

    // Hủy idempotent: đã trừ thì hoàn tiền, chưa trừ thì khóa key để lệnh trừ tới muộn không trừ được nữa.
    app.post<{ Params: { key: string } }>('/charges/:key/void', (request) => {
      const { key } = request.params;
      const current = this.charges.get(key);
      if (current === 'CAPTURED') {
        this.charges.set(key, 'REFUNDED');
      } else if (!current) {
        this.charges.set(key, 'VOIDED');
      }
      return { status: this.charges.get(key) };
    });

    app.post<{ Body: Partial<GatewayBehavior> }>('/admin/behavior', (request) => Object.assign(this.behavior, request.body));
    app.get('/ledger', () => Object.fromEntries(this.charges));
    return app;
  }
}
