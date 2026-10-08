import { Controller, Get } from '@nestjs/common';
import { buildHealthReport, type HealthReport } from '@lab/shared';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  health(): HealthReport {
    return buildHealthReport('api', this.startedAt, process.version);
  }
}
