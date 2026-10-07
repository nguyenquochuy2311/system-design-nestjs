import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parsePriceChange, parseProductId, type ProductPage } from '../shared/product';
import { ProductService } from './product.service';

/** Cùng hợp đồng JSON với bản trước; thêm header X-Cache (HIT/MISS/NEGATIVE-HIT/BYPASS) để quan sát và đo. */
@Controller('sau/products')
export class SauProductsController {
  constructor(@Inject(ProductService) private readonly service: ProductService) {}

  @Get(':id')
  async get(@Param('id') rawId: string, @Res({ passthrough: true }) res: Response): Promise<ProductPage> {
    const id = parseProductId(rawId);
    if (id === null) throw new BadRequestException('id sản phẩm không hợp lệ');
    const { page, source } = await this.service.getById(id);
    res.setHeader('X-Cache', source);
    if (!page) throw new NotFoundException(`không có sản phẩm ${id}`);
    return page;
  }

  @Patch(':id/price')
  @HttpCode(200)
  async updatePrice(@Param('id') rawId: string, @Body() body: unknown): Promise<{ id: number; variantId: number; price: number }> {
    const id = parseProductId(rawId);
    const change = parsePriceChange(body);
    if (id === null || change === null) throw new BadRequestException('cần id sản phẩm, variantId và price là số nguyên dương');
    if (!(await this.service.updatePrice(id, change))) throw new NotFoundException(`không có biến thể ${change.variantId} của sản phẩm ${id}`);
    return { id, ...change };
  }
}
