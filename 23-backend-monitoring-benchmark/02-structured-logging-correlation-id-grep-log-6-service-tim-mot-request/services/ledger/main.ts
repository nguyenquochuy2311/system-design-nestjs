// ledger: sổ cái (trong bộ nhớ cho lab) — bút toán chờ khi tạo topup, xác nhận hoặc đảo sau khi ngân hàng trả lời.
import Fastify from 'fastify';
import { drill, setupLogging, withServerSpan } from '../../packages/logging/index.js';
import { listenPort } from '../shared/http.js';

const log = setupLogging('ledger');
const entries = new Map<string, { amount: number; status: 'PENDING' | 'CONFIRMED' | 'REVERSED' }>();

const app = Fastify({ logger: false });
app.get('/healthz', async () => ({ ok: true }));

app.post<{ Body: { topup_id: string; amount: number } }>('/entries', async (request, reply) =>
  withServerSpan(request.headers, 'POST /entries', async () => {
    const { topup_id, amount } = request.body;
    entries.set(topup_id, { amount, status: 'PENDING' });
    if (drill('console-log-ledger')) console.log(`ghi but toan cho ${topup_id} so tien ${amount}`); // phép thử âm (a)
    else log.info('ledger.entry_pending', 'ghi bút toán chờ', { topup_id, amount });
    return reply.code(201).send({ topup_id, status: 'PENDING' });
  }),
);

app.post<{ Params: { id: string; action: string }; Body: { bank_ref?: string; reason?: string } }>('/entries/:id/:action', async (request, reply) =>
  withServerSpan(request.headers, 'POST /entries/:id/:action', async () => {
    const { id: topup_id, action } = request.params;
    const entry = entries.get(topup_id);
    if (!entry) {
      log.warn('ledger.entry_missing', 'không thấy bút toán', { topup_id });
      return reply.code(404).send({ error: 'not_found' });
    }
    entry.status = action === 'confirm' ? 'CONFIRMED' : 'REVERSED';
    if (entry.status === 'CONFIRMED') log.info('ledger.entry_confirmed', 'xác nhận bút toán', { topup_id, bank_ref: request.body.bank_ref });
    else log.info('ledger.entry_reversed', 'đảo bút toán', { topup_id, reason: request.body.reason });
    return reply.send({ topup_id, status: entry.status });
  }),
);

const port = listenPort(3103);
await app.listen({ host: '0.0.0.0', port });
log.info('service.started', `nghe cổng ${port}`);
process.on('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});
