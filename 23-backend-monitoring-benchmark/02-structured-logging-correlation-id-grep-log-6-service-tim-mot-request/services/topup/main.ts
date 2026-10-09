// topup: tạo giao dịch nạp (topup_id), ghi bút toán chờ ở ledger, đẩy job "charge" sang bank-adapter qua BullMQ.
import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { publishWithContext, setupLogging, withServerSpan } from '../../packages/logging/index.js';
import { listenPort, postJson } from '../shared/http.js';

const log = setupLogging('topup');
const LEDGER_URL = process.env.LEDGER_URL ?? 'http://ledger:3103';
const QUEUE = 'bank-charge';
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE, { connection: redis });

interface TopupBody {
  customer: { phone: string };
  amount: number;
  bank_code: string;
  payment: { card: { number: string } };
}

const app = Fastify({ logger: false });
app.get('/healthz', async () => ({ ok: (await redis.ping()) === 'PONG' }));

app.post<{ Body: TopupBody }>('/topups', async (request, reply) =>
  withServerSpan(request.headers, 'POST /topups', async () => {
    const { customer, amount, bank_code, payment } = request.body;
    const topup_id = `tp_${randomBytes(6).toString('hex')}`;
    log.info('topup.created', 'tạo giao dịch nạp tiền', { topup_id, phone: customer.phone, amount, bank_code });
    const entry = await postJson(`${LEDGER_URL}/entries`, { topup_id, amount });
    if (entry.status >= 300) {
      log.error('topup.ledger_failed', 'ghi bút toán chờ thất bại', { topup_id, status: entry.status });
      return reply.code(502).send({ error: 'ledger_unavailable' });
    }
    // [PATTERN] Job mang traceparent của request này: log của bank-adapter sẽ cùng trace_id.
    const job = await publishWithContext(QUEUE, { topup_id, amount, bank_code, card_number: payment.card.number, phone: customer.phone }, (data) =>
      queue.add('charge', data, { attempts: 1, removeOnComplete: 2000, removeOnFail: 2000 }),
    );
    log.info('topup.enqueued', 'đã đẩy job sang bank-adapter', { topup_id, job_id: job.id, queue: QUEUE });
    return reply.code(202).send({ topup_id });
  }),
);

const port = listenPort(3101);
await app.listen({ host: '0.0.0.0', port });
log.info('service.started', `nghe cổng ${port}`);
process.on('SIGTERM', async () => {
  await app.close();
  await queue.close();
  redis.disconnect();
  process.exit(0);
});
