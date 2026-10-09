// gateway: cửa vào của app ví. Nhận yêu cầu nạp tiền, chuyển sang topup. Không biết topup_id cho tới khi topup trả lời.
import Fastify from 'fastify';
import { setupLogging, withServerSpan } from '../../packages/logging/index.js';
import { listenPort, postJson } from '../shared/http.js';

const log = setupLogging('gateway'); // [PATTERN] dòng đầu của mọi service
const TOPUP_URL = process.env.TOPUP_URL ?? 'http://topup:3101';

interface TopupBody {
  customer: { phone: string; name?: string; contact?: { phone?: string } };
  amount: number;
  bank_code: string;
  payment: { card: { number: string; holder?: string; cvv?: string } };
}

const app = Fastify({ logger: false });
app.get('/healthz', async () => ({ ok: true }));

app.post<{ Body: TopupBody }>('/topups', async (request, reply) =>
  withServerSpan(request.headers, 'POST /topups', async () => {
    const started = performance.now();
    // Log cả request (header chọn lọc + body) như nhiều hệ thống vẫn làm; bản sau che theo đường dẫn trong logger.
    log.info('topup.received', 'nhận yêu cầu nạp tiền', {
      req: {
        method: request.method,
        route: '/topups',
        headers: {
          'x-msisdn': request.headers['x-msisdn'],
          authorization: request.headers.authorization,
          'user-agent': request.headers['user-agent'],
        },
        body: request.body,
      },
    });
    try {
      const res = await postJson<{ topup_id?: string; error?: string }>(`${TOPUP_URL}/topups`, request.body);
      const duration_ms = Number((performance.now() - started).toFixed(1));
      if (res.status >= 500) {
        log.error('topup.upstream_failed', 'topup trả lỗi', { status: res.status, duration_ms });
        return reply.code(502).send({ error: 'topup_unavailable' });
      }
      log.info('topup.accepted', 'topup đã nhận giao dịch', { topup_id: res.body.topup_id, status: res.status, duration_ms });
      return reply.code(res.status).send(res.body);
    } catch (err) {
      log.error('topup.upstream_failed', 'gọi topup thất bại', { err });
      return reply.code(502).send({ error: 'topup_unreachable' });
    }
  }),
);

const port = listenPort(3100);
await app.listen({ host: '0.0.0.0', port });
log.info('service.started', `nghe cổng ${port}`);
process.on('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});
