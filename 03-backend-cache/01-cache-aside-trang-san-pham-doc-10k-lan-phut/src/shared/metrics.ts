import { Injectable } from '@nestjs/common';
import { Counter, Registry } from 'prom-client';

/** Counter phía ứng dụng (mục 5): đối chiếu với keyspace_hits/misses của Redis và calls của pg_stat_statements. */
@Injectable()
export class CatalogMetrics {
  // Registry riêng cho mỗi app: test dựng nhiều app trong cùng tiến trình mà không đụng registry toàn cục.
  readonly registry = new Registry();
  readonly cacheLookups = new Counter({
    name: 'product_cache_lookups_total',
    help: 'Số lần bản sau hỏi cache, theo kết quả: hit, miss, negative_hit, error',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });
  readonly cacheErrors = new Counter({
    name: 'product_cache_errors_total',
    help: 'Lệnh Redis lỗi hoặc quá thời gian chờ, theo thao tác get/set/del',
    labelNames: ['op'] as const,
    registers: [this.registry],
  });
  readonly dbReads = new Counter({
    name: 'product_db_reads_total',
    help: 'Số lần trang sản phẩm đọc PostgreSQL, theo bản truoc/sau',
    labelNames: ['variant'] as const,
    registers: [this.registry],
  });
}
