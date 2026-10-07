import { Injectable } from '@nestjs/common';
import { Counter, Registry } from 'prom-client';

/**
 * Counter phía API (mục 5). Nhãn client tách tải k6 (load) khỏi script đo độ cũ (probe, header X-Client: probe) để hit
 * ratio của tải không bị lượt poll làm đẹp. Lượt BYPASS (Redis lỗi/timeout) đếm riêng, không gộp vào miss (bài 03/01).
 */
@Injectable()
export class ShopMetrics {
  // Registry riêng cho mỗi app: test dựng nhiều app trong cùng tiến trình mà không đụng registry toàn cục.
  readonly registry = new Registry();
  readonly cacheLookups = new Counter({
    name: 'page_cache_lookups_total',
    help: 'Số lần hỏi cache trang, theo bản, loại trang, kết quả (hit/miss/error) và client',
    labelNames: ['variant', 'page', 'result', 'client'] as const,
    registers: [this.registry],
  });
  readonly dbReads = new Counter({
    name: 'page_db_reads_total',
    help: 'Số lần dựng trang từ PostgreSQL, theo bản, loại trang và client',
    labelNames: ['variant', 'page', 'client'] as const,
    registers: [this.registry],
  });
  readonly cacheErrors = new Counter({
    name: 'page_cache_errors_total',
    help: 'Lệnh Redis của đường đọc/ghi trang lỗi hoặc quá thời gian chờ, theo thao tác',
    labelNames: ['variant', 'op'] as const,
    registers: [this.registry],
  });
}
