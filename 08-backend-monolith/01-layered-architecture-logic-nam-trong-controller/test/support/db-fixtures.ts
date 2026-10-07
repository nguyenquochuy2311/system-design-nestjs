import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/shared/db';
import type { CustomerTier } from '../../src/sau/orders/domain/order';

// Mỗi test tự tạo khách và sản phẩm riêng (mã ngẫu nhiên): không phụ thuộc seed, không đụng dữ liệu của test khác.

export async function createCustomer(db: Kysely<Database>, tier: CustomerTier, creditLimit: number): Promise<number> {
  const code = `TEST-C-${randomUUID()}`;
  const row = await db
    .insertInto('customers')
    .values({ code, name: `Đại lý ${code.slice(-6)}`, email: `${code}@example.test`, tier, credit_limit: creditLimit })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function createProduct(db: Kysely<Database>, unitPrice: number, isPromo = false): Promise<number> {
  const sku = `TEST-P-${randomUUID()}`;
  const row = await db
    .insertInto('products')
    .values({ sku, name: `Vật tư ${sku.slice(-6)}`, unit_price: unitPrice, is_promo: isPromo })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Công nợ đang có: một đơn chưa thanh toán không có dòng hàng. */
export async function addUnpaidOrder(db: Kysely<Database>, customerId: number, total: number): Promise<void> {
  await db
    .insertInto('orders')
    .values({ customer_id: customerId, channel: 'web', subtotal: total, discount: 0, total })
    .execute();
}

export async function ordersOf(db: Kysely<Database>, customerId: number) {
  return db.selectFrom('orders').selectAll().where('customer_id', '=', customerId).orderBy('id').execute();
}
