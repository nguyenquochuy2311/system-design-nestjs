import { Inject, Injectable } from '@nestjs/common';
import { CatalogMetrics } from '../shared/metrics';
import type { PriceChange, ProductPage } from '../shared/product';
import { ProductRepository } from '../shared/product.repository';
import { ProductCache } from './product.cache';

/** Nguồn của câu trả lời, trả về client qua header X-Cache để đo độ trễ riêng của lượt trúng và lượt trượt. */
export type PageSource = 'HIT' | 'MISS' | 'NEGATIVE-HIT' | 'BYPASS';

/** Bản "sau": Cache-Aside. Ứng dụng tự quản lý cache; repository và Redis không biết về nhau. */
@Injectable()
export class ProductService {
  constructor(
    @Inject(ProductRepository) private readonly repository: ProductRepository,
    @Inject(ProductCache) private readonly cache: ProductCache,
    @Inject(CatalogMetrics) private readonly metrics: CatalogMetrics,
  ) {}

  async getById(id: number): Promise<{ page: ProductPage | null; source: PageSource }> {
    const cached = await this.cache.get(id); // [PATTERN] 1. hỏi cache trước
    this.metrics.cacheLookups.inc({ result: cached.kind.replace('-', '_') });
    if (cached.kind === 'hit') return { page: cached.page, source: 'HIT' };
    if (cached.kind === 'negative-hit') return { page: null, source: 'NEGATIVE-HIT' };

    const page = await this.repository.findPage(id); // [PATTERN] 2. trượt (hoặc Redis lỗi): đọc DB
    this.metrics.dbReads.inc({ variant: 'sau' });
    // Redis vừa lỗi thì không ghi lại: khỏi chờ thêm một lần timeout cho mỗi request trong lúc Redis treo.
    if (cached.kind === 'error') return { page, source: 'BYPASS' };
    await this.cache.set(id, page); // [PATTERN] 3. nạp cache kèm TTL (null → negative cache 30 s)
    return { page, source: 'MISS' };
  }

  async updatePrice(id: number, change: PriceChange): Promise<boolean> {
    const updated = await this.repository.updatePrice(id, change); // transaction đã COMMIT khi hàm này trả về
    // [PATTERN] xóa key SAU commit, và xóa chứ không ghi giá trị mới: lần đọc sau tự nạp bản mới nhất từ DB
    if (updated) await this.cache.invalidate(id);
    return updated;
  }
}
