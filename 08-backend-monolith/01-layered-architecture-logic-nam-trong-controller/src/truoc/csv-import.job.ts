import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { KYSELY, type Database } from '../shared/db';
import { MAILER, type Mailer } from '../shared/mailer';
import { parseOrdersCsv, type ImportReport } from '../shared/order-input';

interface CustomerRow {
  id: number;
  name: string;
  email: string;
  tier: string;
}

interface ProductRow {
  id: number;
  unit_price: number;
  is_promo: boolean;
}

/**
 * Bản "trước": job nhập file CSV của đại lý. Đoạn tính tiền được chép từ OrdersController.create()
 * lúc controller chưa có bước kiểm hạn mức công nợ, nên đơn từ file không bao giờ bị chặn (lỗi của bài).
 */
@Injectable()
export class CsvImportJob {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async run(csv: string): Promise<ImportReport> {
    const { orders, errors } = parseOrdersCsv(csv);
    const report: ImportReport = { created: [], failed: [...errors] };
    for (const order of orders) {
      try {
        const placed = await this.db.transaction().execute(async (trx) => {
          const customerRows = await sql<CustomerRow>`
            SELECT id, name, email, tier FROM customers WHERE id = ${order.customerId}`.execute(trx);
          const customer = customerRows.rows[0];
          if (!customer) {
            throw new Error(`Không tìm thấy khách hàng ${order.customerId}`);
          }
          const quantities = new Map<number, number>();
          for (const item of order.items) {
            quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
          }
          const productIds = [...quantities.keys()];
          const productRows = await sql<ProductRow>`
            SELECT id, unit_price, is_promo FROM products WHERE id = ANY(${productIds}::bigint[])`.execute(trx);
          if (productRows.rows.length !== productIds.length) {
            throw new Error('Có sản phẩm không tồn tại');
          }

          // chiết khấu theo hạng (chép từ controller)
          let subtotal = 0;
          let discountable = 0;
          const lines: { productId: number; quantity: number; unitPrice: number; lineTotal: number }[] = [];
          for (const p of productRows.rows) {
            const quantity = quantities.get(p.id) ?? 0;
            subtotal += p.unit_price * quantity;
            if (!p.is_promo) discountable += p.unit_price * quantity;
            lines.push({ productId: p.id, quantity, unitPrice: p.unit_price, lineTotal: p.unit_price * quantity });
          }
          let rateBps = 0;
          switch (customer.tier) {
            case 'silver':
              rateBps = 200;
              break;
            case 'gold':
              rateBps = 500;
              break;
            case 'diamond':
              rateBps = 800;
              break;
          }
          if (discountable >= 50_000_000) rateBps += 100;
          const discount = Math.floor((discountable * rateBps) / 10_000);
          const total = subtotal - discount;

          const orderRows = await sql<{ id: number }>`
            INSERT INTO orders (customer_id, channel, external_ref, subtotal, discount, total)
            VALUES (${customer.id}, 'csv', ${order.ref}, ${subtotal}, ${discount}, ${total}) RETURNING id`.execute(trx);
          const orderId = orderRows.rows[0]?.id ?? 0;
          for (const line of lines) {
            await sql`
              INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
              VALUES (${orderId}, ${line.productId}, ${line.quantity}, ${line.unitPrice}, ${line.lineTotal})`.execute(trx);
          }
          return { customer, orderId, total };
        });
        await this.mailer.send({
          to: placed.customer.email,
          subject: `Xác nhận đơn #${placed.orderId}`,
          body: `Chào ${placed.customer.name}, đơn #${placed.orderId} tổng ${placed.total} đồng đã được ghi nhận.`,
        });
        report.created.push({ ref: order.ref, orderId: placed.orderId, total: placed.total });
      } catch (err) {
        report.failed.push({ ref: order.ref, reason: (err as Error).message });
      }
    }
    return report;
  }
}
