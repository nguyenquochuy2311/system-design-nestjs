// API mà trình duyệt gọi (qua rewrite /api/* của Next.js). Giống nhau cho bản trước và bản sau: pattern của bài nằm
// hoàn toàn ở phía client. Mọi response mang no-store (app.ts) để HTTP cache không chen vào phép đo.
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseFilters, type AssignResult, type Me, type Order, type OrderListResponse, type Warehouse } from '../web/orders/contracts';
import { CONFIG, type Config } from './shared/config';
import { dispatcherOf, OrderStore } from './shared/orders.store';
import { uidOf } from './shared/request-log';

function dispatcher(req: Request) {
  const uid = uidOf(req);
  if (!uid) throw new UnauthorizedException('Chưa đăng nhập');
  return dispatcherOf(uid);
}

@Controller('api')
export class OrdersController {
  constructor(
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('orders')
  async list(@Req() req: Request, @Query() q: Record<string, unknown>): Promise<OrderListResponse> {
    const d = dispatcher(req);
    const filters = parseFilters((name) => (typeof q[name] === 'string' ? (q[name] as string) : null));
    if (filters.warehouse !== 'tat-ca' && !d.region.warehouses.some((w) => w.id === filters.warehouse)) {
      throw new BadRequestException(`Kho ${filters.warehouse} không thuộc khu vực ${d.region.id}`);
    }
    // Endpoint nặng nhất: độ trễ giả lập trước khi "truy vấn"; dữ liệu chụp ở cuối, generatedAt là lúc chụp.
    await sleep(this.config.listLatencyMs);
    const r = this.store.list(d.region.id, filters);
    return { items: r.items, total: r.total, pageCount: r.pageCount, filters, generatedAt: Date.now(), seq: r.seq };
  }

  @Get('orders/:id')
  async detail(@Req() req: Request, @Param('id') id: string): Promise<Order> {
    const d = dispatcher(req);
    await sleep(this.config.detailLatencyMs);
    const o = this.store.get(id);
    if (!o || o.region !== d.region.id) throw new NotFoundException(`Không có đơn ${id}`);
    return o;
  }

  @Post('orders/:id/assign')
  @HttpCode(200)
  async assign(@Req() req: Request, @Param('id') id: string, @Body() body: { shipper?: unknown }): Promise<AssignResult> {
    const d = dispatcher(req);
    const shipper = typeof body?.shipper === 'string' && body.shipper.trim() ? body.shipper.trim() : null;
    if (!shipper) throw new BadRequestException('Thiếu shipper');
    await sleep(this.config.writeLatencyMs);
    const current = this.store.get(id);
    if (!current || current.region !== d.region.id) throw new NotFoundException(`Không có đơn ${id}`);
    // Client có thể đang nhìn dữ liệu cũ (đánh đổi của stale-while-revalidate): server vẫn là nơi quyết định.
    const r = this.store.assign(id, shipper, d.uid);
    if (r === 'conflict') throw new ConflictException(`Đơn ${current.code} đã có người nhận (${current.assignee ?? 'không rõ'})`);
    if (!r) throw new NotFoundException(`Không có đơn ${id}`);
    return r;
  }

  @Get('warehouses')
  async warehouses(@Req() req: Request): Promise<Warehouse[]> {
    const d = dispatcher(req);
    await sleep(this.config.metaLatencyMs);
    return d.region.warehouses;
  }

  @Get('me')
  async me(@Req() req: Request): Promise<Me> {
    const d = dispatcher(req);
    await sleep(this.config.metaLatencyMs);
    return { uid: d.uid, name: d.name, region: d.region.id, regionName: d.region.name };
  }
}

/** Đăng nhập giả lập: chọn điều phối viên, không mật khẩu (lab). Cookie uid HttpOnly, chỉ API đọc. */
@Controller('api/session')
export class SessionController {
  @Post()
  @HttpCode(204)
  login(@Body() body: { uid?: unknown }, @Res({ passthrough: true }) res: Response): void {
    const uid = typeof body?.uid === 'string' ? body.uid : '';
    if (!/^[a-z0-9-]{1,40}$/.test(uid)) throw new BadRequestException('uid không hợp lệ');
    res.setHeader('Set-Cookie', `uid=${uid}; Path=/; HttpOnly; SameSite=Lax`);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.setHeader('Set-Cookie', 'uid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  }
}
