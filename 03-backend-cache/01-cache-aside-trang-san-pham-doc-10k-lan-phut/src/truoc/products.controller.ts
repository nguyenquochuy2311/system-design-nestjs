import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch } from '@nestjs/common';
import { CatalogMetrics } from '../shared/metrics';
import { parsePriceChange, parseProductId, type ProductPage } from '../shared/product';
import { ProductRepository } from '../shared/product.repository';

/** Bản "trước": mọi lượt xem trang sản phẩm chạy lại câu join 5 bảng, dù dữ liệu gần như không đổi. */
@Controller('truoc/products')
export class TruocProductsController {
  constructor(
    @Inject(ProductRepository) private readonly repository: ProductRepository,
    @Inject(CatalogMetrics) private readonly metrics: CatalogMetrics,
  ) {}

  @Get(':id')
  async get(@Param('id') rawId: string): Promise<ProductPage> {
    const id = parseProductId(rawId);
    if (id === null) throw new BadRequestException('id sản phẩm không hợp lệ');
    const page = await this.repository.findPage(id);
    this.metrics.dbReads.inc({ variant: 'truoc' });
    if (!page) throw new NotFoundException(`không có sản phẩm ${id}`);
    return page;
  }

  @Patch(':id/price')
  @HttpCode(200)
  async updatePrice(@Param('id') rawId: string, @Body() body: unknown): Promise<{ id: number; variantId: number; price: number }> {
    const id = parseProductId(rawId);
    const change = parsePriceChange(body);
    if (id === null || change === null) throw new BadRequestException('cần id sản phẩm, variantId và price là số nguyên dương');
    if (!(await this.repository.updatePrice(id, change))) throw new NotFoundException(`không có biến thể ${change.variantId} của sản phẩm ${id}`);
    return { id, ...change };
  }
}
