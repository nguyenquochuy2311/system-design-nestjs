import type { ShopMetrics } from './metrics';
import type { PageCache } from './page.cache';
import type { PageRepository } from './page.repository';
import { cacheKeys, type CategoryPage, type HomeDeals, type PageKind, type ProductItem, type ProductPage, type Variant } from './pages';
import type { WatchLog } from './watch-log';

/** Nguồn câu trả lời, trả về client qua header X-Cache. */
export type PageSource = 'HIT' | 'MISS' | 'BYPASS';
export type Client = 'load' | 'probe';

/**
 * Đọc trang theo Cache-Aside (bài 03/01) cho một bản. Hai bản dùng chung lớp này; khác nhau ở `cache`
 * (TTL cố định / TTL có jitter + chỉ mục ngược) và ở đường ghi giá.
 */
export class PagesService {
  constructor(
    readonly variant: Variant,
    private readonly cache: PageCache,
    private readonly repo: PageRepository,
    private readonly metrics: ShopMetrics,
    private readonly watch: WatchLog,
  ) {}

  product(id: number, client: Client) {
    return this.read<ProductPage>('product', cacheKeys.product(this.variant, id), client, () => this.repo.findProduct(id), (p) => [p]);
  }

  category(slug: string, page: number, client: Client) {
    return this.read<CategoryPage>('category', cacheKeys.category(this.variant, slug, page), client, () => this.repo.findCategoryPage(slug, page), (p) => p.items);
  }

  home(client: Client) {
    return this.read<HomeDeals>('home', cacheKeys.home(this.variant), client, () => this.repo.findHomeDeals(), (p) => p.items);
  }

  private async read<T>(
    page: PageKind,
    key: string,
    client: Client,
    load: () => Promise<T | undefined>,
    itemsOf: (body: T) => ProductItem[],
  ): Promise<{ body: T | null; source: PageSource }> {
    const cached = await this.cache.get<T>(key);
    this.metrics.cacheLookups.inc({ variant: this.variant, page, result: cached.kind, client });
    let body: T | null;
    let source: PageSource;
    if (cached.kind === 'hit') {
      body = cached.body;
      source = 'HIT';
    } else {
      body = (await load()) ?? null;
      this.metrics.dbReads.inc({ variant: this.variant, page, client });
      source = cached.kind === 'error' ? 'BYPASS' : 'MISS';
      // Redis vừa lỗi thì không ghi lại (khỏi chờ thêm một lần timeout); sản phẩm không tồn tại thì không cache.
      if (body !== null && cached.kind === 'miss') {
        await this.cache.set(key, body, itemsOf(body).map((item) => item.id));
      }
    }
    if (body !== null) this.watch.record(key, source, client, itemsOf(body));
    return { body, source };
  }
}
