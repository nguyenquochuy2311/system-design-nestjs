import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { KYSELY, type Database } from '../shared/db';
import { MAILER, type Mailer } from '../shared/mailer';
import type { ImportReport, MarketplaceOrder } from '../shared/order-input';
import { formatOrderEmail } from './orders.controller';

interface CustomerRow {
  id: number;
  name: string;
  email: string;
  tier: string;
  credit_limit: number;
}

interface ProductRow {
  id: number;
  unit_price: number;
  is_promo: boolean;
}

// Bảng chiết khấu chép từ phiên bản controller năm ngoái: chưa có khoản cộng 1% cho đơn lớn.
const TIER_BPS: Record<string, number> = { standard: 0, silver: 200, gold: 500, diamond: 800 };

/**
 * Bản "trước": job kéo đơn từ sàn TMĐT. Mang bản sao cũ của quy tắc: chiết khấu thiếu khoản đơn lớn,
 * hạn mức chỉ so giá trị đơn với hạn mức mà quên cộng công nợ đang có. Email lấy từ file controller.
 */
@Injectable()
export class MarketplaceSyncJob {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async run(feed: MarketplaceOrder[]): Promise<ImportReport> {
    const report: ImportReport = { created: [], failed: [] };
    for (const mo of feed) {
      try {
        const placed = await this.db.transaction().execute(async (trx) => {
          const customer = (
            await sql<CustomerRow>`
              SELECT id, name, email, tier, credit_limit FROM customers WHERE id = ${mo.customerId}`.execute(trx)
          ).rows[0];
          if (!customer) throw new Error(`Không tìm thấy khách hàng ${mo.customerId}`);
          const ids = mo.lines.map((l) => l.productId);
          const products = (
            await sql<ProductRow>`SELECT id, unit_price, is_promo FROM products WHERE id = ANY(${ids}::bigint[])`.execute(trx)
          ).rows;
          let subtotal = 0;
          let discountable = 0;
          for (const line of mo.lines) {
            const p = products.find((x) => x.id === line.productId);
            if (!p) throw new Error(`Sản phẩm ${line.productId} không tồn tại`);
            subtotal += p.unit_price * line.qty;
            if (!p.is_promo) discountable += p.unit_price * line.qty;
          }
          const discount = Math.floor((discountable * (TIER_BPS[customer.tier] ?? 0)) / 10_000);
          const total = subtotal - discount;
          if (total > customer.credit_limit) {
            throw new Error('Vượt hạn mức công nợ');
          }
          const orderId = (
            await sql<{ id: number }>`
              INSERT INTO orders (customer_id, channel, external_ref, subtotal, discount, total)
              VALUES (${customer.id}, 'marketplace', ${mo.marketplaceOrderId}, ${subtotal}, ${discount}, ${total})
              RETURNING id`.execute(trx)
          ).rows[0]?.id ?? 0;
          for (const line of mo.lines) {
            const p = products.find((x) => x.id === line.productId);
            await sql`
              INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
              VALUES (${orderId}, ${line.productId}, ${line.qty}, ${p?.unit_price}, ${(p?.unit_price ?? 0) * line.qty})`.execute(trx);
          }
          return { customer, orderId, total };
        });
        await this.mailer.send(formatOrderEmail(placed.customer.email, placed.customer.name, placed.orderId, placed.total));
        report.created.push({ ref: mo.marketplaceOrderId, orderId: placed.orderId, total: placed.total });
      } catch (err) {
        report.failed.push({ ref: mo.marketplaceOrderId, reason: (err as Error).message });
      }
    }
    return report;
  }
}
