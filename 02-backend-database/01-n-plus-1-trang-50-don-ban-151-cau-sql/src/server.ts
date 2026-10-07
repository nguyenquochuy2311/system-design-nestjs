import Fastify from 'fastify';
import { createDb } from './shared/db';
import { countQueries } from './shared/query-counter';
import { listOrdersNaive } from './truoc/order-list.naive-repository';
import { listOrders } from './sau/order-list.repository';

// Hai pool riêng: luồng đặt hàng của khách và trang quản trị chỉ chung DATABASE, không chung connection pool,
// để phép đo "trang quản trị làm chậm đặt hàng" phản ánh đúng tranh chấp ở phía database.
const db = createDb();
const orderDb = createDb();
const app = Fastify({ logger: false });

app.get('/healthz', async () => ({ ok: true }));

// GET /orders?page=0&mode=batch|naive — header x-query-count cho biết số câu SQL của chính request này.
app.get<{ Querystring: { page?: string; mode?: string } }>('/orders', async (req, reply) => {
  const page = Math.max(0, Number.parseInt(req.query.page ?? '0', 10) || 0);
  const run = req.query.mode === 'naive' ? listOrdersNaive : listOrders;
  const { result, count } = await countQueries(() => run(db, page));
  reply.header('x-query-count', String(count));
  return result;
});

// POST /place-order — luồng "đặt hàng của khách", để đo ảnh hưởng của trang quản trị tới nó.
const { max } = await orderDb.selectFrom('customers').select((eb) => eb.fn.max('id').as('max')).executeTakeFirstOrThrow();
const customerCount = max ?? 1;
app.post('/place-order', async () =>
  orderDb.transaction().execute(async (trx) => {
    const customerId = 1 + Math.floor(Math.random() * customerCount);
    const order = await trx
      .insertInto('orders')
      .values({ customer_id: customerId, status: 'new', total_cents: 150_000 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('order_items')
      .values([
        { order_id: order.id, product_name: 'Sản phẩm A', quantity: 1, price_cents: 50_000 },
        { order_id: order.id, product_name: 'Sản phẩm B', quantity: 2, price_cents: 50_000 },
      ])
      .execute();
    await trx.insertInto('shipments').values({ order_id: order.id, status: 'pending', carrier: 'carrier-a' }).execute();
    return { id: order.id };
  }),
);

const port = Number(process.env.PORT ?? 3100);
await app.listen({ port, host: '127.0.0.1' });
console.log(`API lắng nghe tại http://127.0.0.1:${port}`);
