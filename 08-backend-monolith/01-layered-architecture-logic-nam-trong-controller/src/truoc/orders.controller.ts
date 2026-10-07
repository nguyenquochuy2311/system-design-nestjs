import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { KYSELY, type Database } from '../shared/db';
import { MAILER, type Mailer, type OrderEmail } from '../shared/mailer';

interface CustomerRow {
  id: number;
  name: string;
  email: string;
  tier: string;
  credit_limit: number;
}

interface ProductRow {
  id: number;
  name: string;
  unit_price: number;
  is_promo: boolean;
}

/**
 * Bản "trước": cả luồng đặt hàng nằm trong một phương thức controller — đọc body, SQL viết tay,
 * chiết khấu theo hạng, hạn mức công nợ, ghi đơn, gửi email. File này tái hiện triệu chứng của bài,
 * đừng sửa cho "đẹp": job CSV và job đồng bộ sàn mang bản sao của các đoạn bên dưới.
 */
@Controller('truoc/orders')
export class OrdersController {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: any) {
    // --- kiểm tra body ---
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body phải là JSON object');
    }
    const customerId = body.customerId;
    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw new BadRequestException('customerId phải là số nguyên dương');
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('Đơn phải có ít nhất một dòng hàng');
    }
    if (body.items.length > 100) {
      throw new BadRequestException('Đơn tối đa 100 dòng hàng');
    }
    const quantities = new Map<number, number>();
    for (const item of body.items) {
      if (!item || !Number.isInteger(item.productId) || item.productId <= 0) {
        throw new BadRequestException('productId phải là số nguyên dương');
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 10_000) {
        throw new BadRequestException('quantity phải là số nguyên từ 1 đến 10000');
      }
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      // --- khách hàng: khóa dòng để hai đơn cùng lúc không cùng lọt hạn mức ---
      const customerRows = await sql<CustomerRow>`
        SELECT id, name, email, tier, credit_limit FROM customers WHERE id = ${customerId} FOR UPDATE`.execute(trx);
      const customer = customerRows.rows[0];
      if (!customer) {
        throw new NotFoundException(`Không tìm thấy khách hàng ${customerId}`);
      }

      // --- sản phẩm ---
      const productIds = [...quantities.keys()];
      const productRows = await sql<ProductRow>`
        SELECT id, name, unit_price, is_promo FROM products WHERE id = ANY(${productIds}::bigint[])`.execute(trx);
      if (productRows.rows.length !== productIds.length) {
        const found = new Set(productRows.rows.map((p) => p.id));
        const missing = productIds.filter((id) => !found.has(id));
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'unknown_product',
          message: `Không có sản phẩm: ${missing.join(', ')}`,
        });
      }

      // --- tiền hàng và chiết khấu theo hạng khách ---
      let subtotal = 0;
      let discountable = 0;
      const lines: { productId: number; quantity: number; unitPrice: number; lineTotal: number }[] = [];
      for (const product of productRows.rows) {
        const quantity = quantities.get(product.id) ?? 0;
        const lineTotal = product.unit_price * quantity;
        subtotal += lineTotal;
        if (!product.is_promo) {
          discountable += lineTotal; // hàng khuyến mãi đã giảm sẵn, không cộng chiết khấu hạng
        }
        lines.push({ productId: product.id, quantity, unitPrice: product.unit_price, lineTotal });
      }
      let rateBps = 0;
      if (customer.tier === 'silver') {
        rateBps = 200;
      } else if (customer.tier === 'gold') {
        rateBps = 500;
      } else if (customer.tier === 'diamond') {
        rateBps = 800;
      }
      if (discountable >= 50_000_000) {
        rateBps += 100; // đơn lớn được cộng thêm 1%
      }
      const discount = Math.floor((discountable * rateBps) / 10_000);
      const total = subtotal - discount;

      // --- hạn mức công nợ: tổng đơn chưa thanh toán cộng đơn này không được vượt hạn mức ---
      const debtRows = await sql<{ outstanding: number }>`
        SELECT COALESCE(SUM(total), 0)::bigint AS outstanding
        FROM orders WHERE customer_id = ${customerId} AND status = 'unpaid'`.execute(trx);
      const outstanding = debtRows.rows[0]?.outstanding ?? 0;
      if (outstanding + total > customer.credit_limit) {
        const shortfall = outstanding + total - customer.credit_limit;
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'credit_limit_exceeded',
          message: `Vượt hạn mức công nợ, còn thiếu ${shortfall} đồng`,
          shortfall,
        });
      }

      // --- ghi đơn ---
      const orderRows = await sql<{ id: number }>`
        INSERT INTO orders (customer_id, channel, subtotal, discount, total)
        VALUES (${customerId}, 'web', ${subtotal}, ${discount}, ${total}) RETURNING id`.execute(trx);
      const orderId = orderRows.rows[0]?.id ?? 0;
      await sql`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
        SELECT ${orderId}, * FROM unnest(
          ${lines.map((l) => l.productId)}::bigint[], ${lines.map((l) => l.quantity)}::int[],
          ${lines.map((l) => l.unitPrice)}::bigint[], ${lines.map((l) => l.lineTotal)}::bigint[])`.execute(trx);

      return { customer, order: { orderId, customerId, subtotal, discount, total } };
    });

    // --- email xác nhận ---
    await this.mailer.send(
      formatOrderEmail(result.customer.email, result.customer.name, result.order.orderId, result.order.total),
    );
    return result.order;
  }
}

/** Mẫu email xác nhận đơn. Job đồng bộ sàn import hàm này thẳng từ file controller. */
export function formatOrderEmail(to: string, name: string, orderId: number, total: number): OrderEmail {
  return {
    to,
    subject: `Xác nhận đơn #${orderId}`,
    body: `Chào ${name}, đơn #${orderId} tổng ${total} đồng đã được ghi nhận.`,
  };
}
