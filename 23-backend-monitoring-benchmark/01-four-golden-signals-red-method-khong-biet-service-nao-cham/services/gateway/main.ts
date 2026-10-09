// gateway: cửa vào của khách. Chuyển "đặt hàng" và "xem đơn" sang checkout, đặt timeout cho lời gọi xuống dưới.
import { initTelemetry, registerHttpServerMetrics, requestJson } from '../../packages/observability/index.js';
import Fastify from 'fastify';
import { listenPort, textLog } from '../shared/text-log.js';

// [PATTERN] Dòng đầu của mọi service: khởi tạo gói observability chung.
const telemetry = initTelemetry();
const log = textLog('gateway');
const CHECKOUT_URL = process.env.CHECKOUT_URL ?? 'http://checkout:3101';
const TIMEOUT_MS = Number(process.env.CHECKOUT_TIMEOUT_MS ?? 5000);

const app = Fastify({ logger: false });
registerHttpServerMetrics(app);

app.get('/healthz', async () => ({ ok: true }));

async function forward(path: string, method: string, body: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) {
  try {
    const res = await requestJson(`${CHECKOUT_URL}${path}`, { method, body, timeoutMs: TIMEOUT_MS });
    if (res.status >= 500) {
      log.error(`checkout trả ${res.status} cho ${method} ${path}`);
      return reply.code(502).send({ error: 'checkout_unavailable' });
    }
    return reply.code(res.status).send(res.body);
  } catch (err) {
    const timeout = (err as Error).name === 'TimeoutError';
    log.error(`gọi checkout thất bại (${method} ${path}): ${(err as Error).message}`);
    return reply.code(timeout ? 504 : 502).send({ error: timeout ? 'checkout_timeout' : 'checkout_unreachable' });
  }
}

app.post('/checkout', async (request, reply) => forward('/orders', 'POST', request.body, reply));
app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) =>
  forward(`/orders/${encodeURIComponent(request.params.id)}`, 'GET', undefined, reply),
);

const port = listenPort(3100);
await app.listen({ host: '0.0.0.0', port });
log.info(`nghe cổng ${port}, telemetry ${telemetry.enabled ? `bật (service.name=${telemetry.serviceName})` : 'tắt'}`);

process.on('SIGTERM', async () => {
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
});
