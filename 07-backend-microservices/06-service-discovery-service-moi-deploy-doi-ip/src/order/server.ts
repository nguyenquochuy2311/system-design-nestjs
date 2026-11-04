import { resolve4 } from 'node:dns/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { PricingClient } from './pricing-client';

export interface OrderOptions {
  pricingTargets: string[];
  maxConnectionAgeMs: number;
  retries: number;
  legacyUrl?: string;
  headlessName?: string;
}

interface PodStats {
  count: number;
  firstAt: number;
  lastAt: number;
}

export function buildOrder(options: OrderOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const client = new PricingClient(options.pricingTargets, {
    timeoutMs: 1_000,
    connectTimeoutMs: 300,
    maxConnectionAgeMs: options.maxConnectionAgeMs,
    retries: options.retries,
  });
  let byPod = new Map<string, PodStats>();
  let perSecond = new Map<number, { ok: number; failed: number }>();
  const second = () => {
    const now = Math.floor(Date.now() / 1_000);
    const entry = perSecond.get(now) ?? { ok: 0, failed: 0 };
    perSecond.set(now, entry);
    return entry;
  };

  app.get('/healthz', () => 'ok');

  app.get<{ Querystring: { km?: string } }>('/quote', async (request, reply) => {
    try {
      const quote = await client.quote(Number(request.query.km ?? 1));
      const now = Date.now();
      const stats = byPod.get(quote.pod) ?? { count: 0, firstAt: now, lastAt: now };
      byPod.set(quote.pod, { count: stats.count + 1, firstAt: stats.firstAt, lastAt: now });
      second().ok += 1;
      return quote;
    } catch {
      second().failed += 1;
      return reply.code(502).send({ message: 'Không tính được cước' });
    }
  });

  // Đếm theo pod ở phía gọi, nên thấy đúng tải thật đi tới pod nào, kể cả pod đã bị xóa.
  app.get('/stats', () => ({ byPod: Object.fromEntries(byPod), perSecond: Object.fromEntries(perSecond) }));
  app.post('/stats/reset', () => {
    byPod = new Map();
    perSecond = new Map();
    return { reset: true };
  });

  // Client-side discovery: headless Service trả thẳng IP các pod Ready.
  app.get('/discover', async () => ({ addresses: (await resolve4(String(options.headlessName))).sort() }));

  // Service không selector trỏ tới phần còn ở máy ảo: phía gọi vẫn dùng cùng kiểu tên DNS.
  app.get('/legacy', async () => {
    const response = await fetch(`${String(options.legacyUrl)}/quote?km=1`, { signal: AbortSignal.timeout(1_000) });
    return { status: response.status, body: await response.json() };
  });

  app.addHook('onClose', () => client.close());
  return app;
}
