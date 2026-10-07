import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { classifyDbError } from './shared/db-errors';
import { InsufficientFundsError, transfer, WalletNotFoundError, type TransferInput } from './shared/transfer';

const transferSchema = {
  body: {
    type: 'object',
    required: ['fromWalletId', 'toWalletId', 'amount', 'userId'],
    properties: {
      fromWalletId: { type: 'integer', minimum: 1 },
      toWalletId: { type: 'integer', minimum: 1 },
      amount: { type: 'integer', minimum: 1 },
      userId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
} as const;

/**
 * API ví của một pod. Pool truyền vào quyết định "trước" (thẳng PostgreSQL) hay "sau" (qua PgBouncer).
 * Lỗi kết nối DB trả 503 kèm loại lỗi để k6 đếm riêng "too many clients", "pool timeout"...
 */
export function buildApp(pool: pg.Pool, opts: { podName: string; logLevel?: string }): FastifyInstance {
  const app = Fastify({ logger: opts.logLevel ? { level: opts.logLevel } : false });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-pod', opts.podName);
  });

  app.setErrorHandler((err, req, reply) => {
    const kind = classifyDbError(err);
    if (kind) {
      const e = err as Error & { code?: string };
      req.log.warn({ pod: opts.podName, kind, code: e.code }, `lỗi kết nối DB: ${e.message}`);
      return reply.code(503).send({ error: kind, message: e.message });
    }
    if (err instanceof InsufficientFundsError) return reply.code(422).send({ error: 'insufficient_funds', message: err.message });
    if (err instanceof WalletNotFoundError) return reply.code(404).send({ error: 'wallet_not_found', message: err.message });
    return reply.send(err); // lỗi validate (400) và lỗi khác giữ cách xử lý mặc định của Fastify
  });

  // Liveness: không chạm DB, để DB chậm không làm orchestrator giết pod.
  app.get('/healthz', async () => ({ ok: true, pod: opts.podName }));

  // Readiness: pod chỉ nhận traffic khi lấy được kết nối DB.
  app.get('/readyz', async () => {
    await pool.query('SELECT 1');
    return { ok: true, pod: opts.podName };
  });

  app.post<{ Body: TransferInput }>('/transfers', { schema: transferSchema }, async (req, reply) => {
    if (req.body.fromWalletId === req.body.toWalletId) {
      return reply.code(400).send({ error: 'same_wallet', message: 'Ví gửi và ví nhận phải khác nhau' });
    }
    return transfer(pool, req.body);
  });

  return app;
}
