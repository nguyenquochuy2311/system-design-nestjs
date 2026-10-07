import { Controller, Get, Header, Inject } from '@nestjs/common';
import { CatalogMetrics } from './metrics';

@Controller()
export class OpsController {
  constructor(@Inject(CatalogMetrics) private readonly metrics: CatalogMetrics) {}

  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }

  /** Định dạng text của Prometheus; script đo đọc trước/sau mỗi lượt k6. */
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  read(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
