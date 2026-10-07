import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { isVariant, parseId, parsePage, parsePrice, parseSlug } from './shared/pages';
import type { Client, PageSource } from './shared/pages.service';
import { SAU, TRUOC, type VariantHandlers } from './shared/variant';

/**
 * Cùng một hợp đồng HTTP cho hai bản, chọn theo tiền tố URL: /truoc/... (chỉ TTL) và /sau/... (outbox + chỉ mục ngược).
 * Header X-Cache (HIT/MISS/BYPASS) để quan sát; X-Client: probe đánh dấu request của script đo độ cũ.
 */
@Controller(':variant')
export class ShopController {
  constructor(
    @Inject(TRUOC) private readonly truoc: VariantHandlers,
    @Inject(SAU) private readonly sau: VariantHandlers,
  ) {}

  @Get('products/:id')
  async product(@Param('variant') v: string, @Param('id') rawId: string, @Headers('x-client') c: string | undefined, @Res({ passthrough: true }) res: Response) {
    const id = parseId(rawId);
    if (id === null) throw new BadRequestException('id sản phẩm không hợp lệ');
    const { body, source } = await this.of(v).pages.product(id, client(c));
    return reply(res, source, body, `không có sản phẩm ${id}`);
  }

  @Get('categories/:slug')
  async category(@Param('variant') v: string, @Param('slug') rawSlug: string, @Query('page') rawPage: string | undefined, @Headers('x-client') c: string | undefined, @Res({ passthrough: true }) res: Response) {
    const slug = parseSlug(rawSlug);
    const page = parsePage(rawPage);
    if (slug === null || page === null) throw new BadRequestException('danh mục hoặc số trang không hợp lệ');
    const { body, source } = await this.of(v).pages.category(slug, page, client(c));
    return reply(res, source, body, '');
  }

  @Get('home/deals')
  async home(@Param('variant') v: string, @Headers('x-client') c: string | undefined, @Res({ passthrough: true }) res: Response) {
    const { body, source } = await this.of(v).pages.home(client(c));
    return reply(res, source, body, '');
  }

  /** Đường ghi 1: màn hình admin của người bán. */
  @Patch('admin/products/:id/price')
  @HttpCode(200)
  async setPrice(@Param('variant') v: string, @Param('id') rawId: string, @Body() body: unknown) {
    const id = parseId(rawId);
    const price = parsePrice(body);
    if (id === null || price === null) throw new BadRequestException('cần id sản phẩm và price là số nguyên dương');
    if (!(await this.of(v).adminSetPrice(id, price))) throw new NotFoundException(`không có sản phẩm ${id}`);
    return { id, price };
  }

  @Post('orders')
  @HttpCode(201)
  async order(@Param('variant') v: string, @Body() body: unknown, @Headers('x-client') c: string | undefined) {
    const productId = parseId((body as { productId?: unknown } | null)?.productId);
    if (productId === null) throw new BadRequestException('cần productId là số nguyên dương');
    const order = await this.of(v).placeOrder(productId, client(c));
    if (!order) throw new NotFoundException(`không có sản phẩm ${productId}`);
    return order;
  }

  private of(variant: string): VariantHandlers {
    if (!isVariant(variant)) throw new NotFoundException(`không có bản ${variant}`);
    return variant === 'truoc' ? this.truoc : this.sau;
  }
}

const client = (header: string | undefined): Client => (header === 'probe' ? 'probe' : 'load');

function reply<T>(res: Response, source: PageSource, body: T | null, notFound: string): T {
  res.setHeader('X-Cache', source);
  if (body === null) throw new NotFoundException(notFound);
  return body;
}
