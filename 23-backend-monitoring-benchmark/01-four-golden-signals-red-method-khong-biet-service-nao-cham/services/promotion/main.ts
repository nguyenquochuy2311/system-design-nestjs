// promotion: tính giảm giá theo mã khuyến mãi. Quy tắc nằm trong bộ nhớ, không có DB — ở game day nó luôn khỏe.
import { initTelemetry, registerHttpServerMetrics } from '../../packages/observability/index.js';
import Fastify from 'fastify';
import { listenPort, textLog } from '../shared/text-log.js';

const telemetry = initTelemetry();
const log = textLog('promotion');

const RULES: Record<string, { percent: number; cap: number }> = {
  SALE10: { percent: 10, cap: 50_000 },
  FREESHIP: { percent: 5, cap: 30_000 },
};

const app = Fastify({ logger: false });
registerHttpServerMetrics(app);

app.get('/healthz', async () => ({ ok: true }));

app.get<{ Params: { code: string }; Querystring: { amount?: string } }>('/promotions/:code', async (request, reply) => {
  const rule = RULES[request.params.code.toUpperCase()];
  if (!rule) return reply.code(404).send({ error: 'unknown_code' });
  const amount = Number(request.query.amount ?? 0);
  return { code: request.params.code.toUpperCase(), discount: Math.min(Math.floor((amount * rule.percent) / 100), rule.cap) };
});

const port = listenPort(3102);
await app.listen({ host: '0.0.0.0', port });
log.info(`nghe cổng ${port}, telemetry ${telemetry.enabled ? `bật (service.name=${telemetry.serviceName})` : 'tắt'}`);

process.on('SIGTERM', async () => {
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
});
