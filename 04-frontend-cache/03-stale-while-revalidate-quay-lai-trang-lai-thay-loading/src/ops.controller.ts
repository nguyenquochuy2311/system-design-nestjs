// Route chỉ cho test và script đo (không đi qua Next.js, API chỉ nghe 127.0.0.1): đặt lại dữ liệu, giả lập người
// khác đổi đơn, đọc lịch sử thay đổi và nhật ký request.
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { isStatusFilter, parseFilters, type OrderStatus } from '../web/orders/contracts';
import { dispatcherOf, OrderStore, REGIONS } from './shared/orders.store';
import { RequestLog } from './shared/request-log';

@Controller('ops')
export class OpsController {
  constructor(
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(RequestLog) private readonly log: RequestLog,
  ) {}

  @Get('health')
  health() {
    return { ok: true, pid: process.pid, seq: this.store.seq };
  }

  @Post('reset')
  @HttpCode(200)
  reset(@Body() body: { seed?: unknown }) {
    this.log.lines.length = 0;
    return this.store.reset(typeof body?.seed === 'number' ? body.seed : 42);
  }

  @Get('history')
  history() {
    return this.store.history();
  }

  @Get('requests')
  requests(@Query('since') since?: string, @Query('uid') uid?: string) {
    const from = Number(since ?? 0);
    return this.log.lines.filter((l) => l.t >= from && (!uid || l.uid === uid));
  }

  /** Danh sách đúng lúc này, không độ trễ: test so màn hình với dữ liệu thật. */
  @Get('truth')
  truth(@Query() q: Record<string, string>) {
    const d = dispatcherOf(q.uid ?? 'd01');
    const filters = parseFilters((name) => q[name] ?? null);
    return { ...this.store.list(d.region.id, filters), filters, region: d.region.id };
  }

  @Post('orders/:id/change')
  @HttpCode(200)
  change(@Param('id') id: string, @Body() body: { status?: unknown; assignee?: unknown }) {
    const status = isStatusFilter(body?.status) && body.status !== 'tat-ca' ? (body.status as OrderStatus) : undefined;
    const assignee = typeof body?.assignee === 'string' || body?.assignee === null ? (body.assignee as string | null) : undefined;
    const c = this.store.change(id, { status, assignee });
    if (!c) throw new NotFoundException(id);
    return c;
  }

  @Post('regions/:region/orders')
  @HttpCode(200)
  create(@Param('region') region: string) {
    if (!REGIONS.some((r) => r.id === region)) throw new NotFoundException(region);
    return this.store.create(region);
  }

  @Post('regions/:region/others-tick')
  @HttpCode(200)
  othersTick(@Param('region') region: string) {
    if (!REGIONS.some((r) => r.id === region)) throw new NotFoundException(region);
    // Luôn trả JSON: không có đơn phù hợp để đổi thì change = null (body rỗng làm client đọc JSON lỗi).
    return { change: this.store.othersTick(region) ?? null };
  }
}
