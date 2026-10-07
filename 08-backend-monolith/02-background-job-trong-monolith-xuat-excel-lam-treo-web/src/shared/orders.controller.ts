import { BadRequestException, Body, Controller, Get, Inject, Post } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { KYSELY, type Database } from './db';

interface CreateOrderBody {
  tenantId?: number;
  storeName?: string;
  customerName?: string;
  customerPhone?: string;
  items?: { price: number; quantity: number }[];
}

/**
 * Các API "khác" của monolith mà nhân viên cửa hàng dùng hằng ngày: tạo đơn, và health check của load balancer.
 * Bài đo xem chúng còn nhanh không khi có người đang xuất Excel.
 */
@Controller()
export class OrdersController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('orders')
  async create(@Body() body: CreateOrderBody) {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!Number.isInteger(body?.tenantId) || items.length === 0 || !body.storeName || !body.customerName) {
      throw new BadRequestException('cần tenantId, storeName, customerName và ít nhất một món');
    }
    const subtotal = items.reduce((s, i) => s + Math.round(Number(i.price)) * Math.round(Number(i.quantity)), 0);
    const discount = subtotal >= 1_000_000 ? Math.round(subtotal * 0.05) : 0;
    const order = await this.db
      .insertInto('orders')
      .values({
        tenant_id: body.tenantId as number,
        code: `DH${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`,
        store_name: body.storeName,
        customer_name: body.customerName,
        customer_phone: body.customerPhone ?? '',
        status: 'new',
        item_count: items.length,
        subtotal,
        discount,
        total: subtotal - discount,
      })
      .returning(['id', 'total'])
      .executeTakeFirstOrThrow();
    return order;
  }
}
