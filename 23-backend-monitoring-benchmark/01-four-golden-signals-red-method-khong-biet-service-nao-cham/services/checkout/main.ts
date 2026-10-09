// checkout: tạo đơn (hỏi promotion lấy giảm giá rồi ghi DB trong một transaction) và đọc đơn. Kết nối DB đi qua
// Toxiproxy (toxiproxy:15432 → postgres:5432) để game day làm chậm đúng đoạn checkout → DB.
import { initTelemetry, observePgPool, registerHttpServerMetrics, requestJson } from '../../packages/observability/index.js';
import Fastify from 'fastify';
import pg from 'pg';
import { listenPort, textLog } from '../shared/text-log.js';

const telemetry = initTelemetry();
const log = textLog('checkout');
const PROMOTION_URL = process.env.PROMOTION_URL ?? 'http://promotion:3102';
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 10);

// Cấu hình pool giữ mặc định của pg ngoài `max`: connectionTimeoutMillis = 0 nghĩa là request chờ kết nối vô hạn,
// không ném lỗi — pool cạn chỉ hiện ra thành "chậm", không có dòng log lỗi nào ở checkout.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: POOL_MAX });
pool.on('error', (err) => log.error(`kết nối DB rảnh bị lỗi: ${err.message}`));
const db = observePgPool(pool, { poolName: 'checkout', max: POOL_MAX });

interface OrderInput {
  customerId: number;
  items: { sku: string; qty: number; price: number }[];
  code?: string;
}

const app = Fastify({ logger: false });
registerHttpServerMetrics(app);
app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
  log.error(`${request.method} ${request.url} lỗi: ${err.message}`);
  return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: 'internal' });
});

app.get('/healthz', async () => ({ ok: true }));

app.post<{ Body: OrderInput }>('/orders', async (request, reply) => {
  const { customerId, items, code } = request.body ?? ({} as OrderInput);
  if (!Number.isInteger(customerId) || !Array.isArray(items) || items.length === 0) {
    return reply.code(400).send({ error: 'invalid_order' });
  }
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  let discount = 0;
  if (code) {
    const promo = await requestJson<{ discount: number }>(
      `${PROMOTION_URL}/promotions/${encodeURIComponent(code)}?amount=${subtotal}`,
      { timeoutMs: 2000 },
    );
    if (promo.status === 200 && promo.body) discount = promo.body.discount;
  }

  const client = await db.acquire();
  try {
    await db.query(client, 'BEGIN');
    const { rows } = await db.query<{ id: string }>(
      client,
      'INSERT INTO orders (customer_id, subtotal, discount, total) VALUES ($1, $2, $3, $4) RETURNING id',
      [customerId, subtotal, discount, subtotal - discount],
    );
    const id = rows[0]!.id;
    await db.query(
      client,
      'INSERT INTO order_items (order_id, sku, qty, price) SELECT $1, * FROM unnest($2::text[], $3::int[], $4::int[])',
      [id, items.map((i) => i.sku), items.map((i) => i.qty), items.map((i) => i.price)],
    );
    await db.query(client, 'COMMIT');
    log.info(`tạo đơn #${id} cho khách ${customerId}, tổng ${subtotal - discount}`);
    return reply.code(201).send({ id: Number(id), total: subtotal - discount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
});

app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid_id' });
  const client = await db.acquire();
  try {
    const { rows } = await db.query(client, 'SELECT id, customer_id, total, created_at FROM orders WHERE id = $1', [id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'not_found' });
    return rows[0];
  } finally {
    client.release();
  }
});

const port = listenPort(3101);
await app.listen({ host: '0.0.0.0', port });
log.info(`nghe cổng ${port}, pool max ${POOL_MAX}, telemetry ${telemetry.enabled ? `bật (service.name=${telemetry.serviceName})` : 'tắt'}`);

process.on('SIGTERM', async () => {
  await app.close();
  await pool.end();
  await telemetry.shutdown();
  process.exit(0);
});
