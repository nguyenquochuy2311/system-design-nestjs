import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { PAGE_SIZE, type OrderListItem } from '../shared/order-list';

/**
 * [PATTERN] PHIÊN BẢN "SAU": tải theo lô (eager loading ở tầng SQL).
 * 1 câu lấy 50 đơn + 1 câu cho mỗi loại quan hệ bằng `= ANY(mảng id)` => đúng 4 câu,
 * không phụ thuộc số dòng trên trang. Ghép kết quả bằng Map trong bộ nhớ (tuyến tính).
 */
export async function listOrders(db: Kysely<Database>, page: number): Promise<OrderListItem[]> {
  const orders = await db
    .selectFrom('orders')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE)
    .execute();
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const customerIds = [...new Set(orders.map((o) => o.customer_id))];

  const [customers, items, shipments] = await Promise.all([
    db.selectFrom('customers').select(['id', 'name']).where(sql<boolean>`id = ANY(${customerIds})`).execute(),
    db
      .selectFrom('order_items')
      .select(['id', 'order_id', 'product_name', 'quantity', 'price_cents'])
      .where(sql<boolean>`order_id = ANY(${orderIds})`)
      .orderBy('id')
      .execute(),
    db.selectFrom('shipments').select(['order_id', 'status', 'carrier']).where(sql<boolean>`order_id = ANY(${orderIds})`).execute(),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const shipmentByOrder = new Map(shipments.map((s) => [s.order_id, { status: s.status, carrier: s.carrier }]));
  const itemsByOrder = new Map<number, OrderListItem['items']>();
  for (const item of items) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({ id: item.id, productName: item.product_name, quantity: item.quantity, priceCents: item.price_cents });
    itemsByOrder.set(item.order_id, list);
  }

  return orders.map((order) => {
    const customer = customerById.get(order.customer_id);
    if (!customer) throw new Error(`Thiếu khách hàng ${order.customer_id} cho đơn ${order.id}`);
    return {
      id: order.id,
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      customer,
      items: itemsByOrder.get(order.id) ?? [],
      shipment: shipmentByOrder.get(order.id) ?? null,
    };
  });
}
