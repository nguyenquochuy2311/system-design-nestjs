import type { Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { PAGE_SIZE, type OrderListItem } from '../shared/order-list';

/**
 * PHIÊN BẢN "TRƯỚC": tái hiện N+1.
 * 1 câu lấy 50 đơn, rồi trong vòng lặp mỗi đơn bắn thêm 3 câu (khách, sản phẩm, giao hàng)
 * => 1 + 50 × 3 = 151 câu SQL, mỗi câu một vòng mạng tới DB.
 */
export async function listOrdersNaive(db: Kysely<Database>, page: number): Promise<OrderListItem[]> {
  const orders = await db
    .selectFrom('orders')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE)
    .execute();

  const result: OrderListItem[] = [];
  for (const order of orders) {
    const customer = await db
      .selectFrom('customers')
      .select(['id', 'name'])
      .where('id', '=', order.customer_id)
      .executeTakeFirstOrThrow();
    const items = await db
      .selectFrom('order_items')
      .select(['id', 'product_name', 'quantity', 'price_cents'])
      .where('order_id', '=', order.id)
      .orderBy('id')
      .execute();
    const shipment = await db
      .selectFrom('shipments')
      .select(['status', 'carrier'])
      .where('order_id', '=', order.id)
      .executeTakeFirst();

    result.push({
      id: order.id,
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      customer,
      items: items.map((i) => ({ id: i.id, productName: i.product_name, quantity: i.quantity, priceCents: i.price_cents })),
      shipment: shipment ?? null,
    });
  }
  return result;
}
