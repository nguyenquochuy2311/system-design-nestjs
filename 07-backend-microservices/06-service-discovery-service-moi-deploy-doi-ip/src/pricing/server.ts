import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import Fastify, { type FastifyInstance } from 'fastify';

export interface PricingOptions {
  /** Thời gian giả định để kết nối DB lúc khởi động: trong khoảng này pod sống nhưng chưa sẵn sàng. */
  startupDelayMs: number;
}

export function buildPricing({ startupDelayMs }: PricingOptions): FastifyInstance {
  const app = Fastify({ logger: false, forceCloseConnections: 'idle' });
  let dependenciesReady = false;
  let forcedNotReady = false;
  void sleep(startupDelayMs).then(() => {
    dependenciesReady = true;
  });

  // [PATTERN] Tách hai câu hỏi. /live: tiến trình còn chạy không, sai thì khởi động lại.
  app.get('/live', () => 'ok');

  // [PATTERN] /ready: có nên nhận request không, sai thì chỉ gỡ khỏi EndpointSlice. Chỉ kiểm phụ thuộc của chính service,
  // không kiểm downstream, nếu không một phụ thuộc chậm làm mọi pod bị gỡ cùng lúc.
  app.get('/ready', (_request, reply) =>
    dependenciesReady && !forcedNotReady ? 'ok' : reply.code(503).send('chưa sẵn sàng'),
  );

  // Chưa có DB thì chưa tính được cước: request tới pod chưa sẵn sàng là request lỗi thật.
  app.get<{ Querystring: { km?: string } }>('/quote', (request, reply) =>
    dependenciesReady
      ? { pod: hostname(), priceVnd: 15_000 + Number(request.query.km ?? 1) * 4_000 }
      : reply.code(503).send({ message: 'Chưa kết nối được DB' }),
  );

  // Cờ cho phép thử: giả lập pod mất kết nối DB.
  app.post<{ Querystring: { ok: string } }>('/admin/ready', (request) => {
    forcedNotReady = request.query.ok !== 'true';
    return { forcedNotReady, at: Date.now() };
  });

  return app;
}
