import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Module,
  Post,
  Res,
  type DynamicModule,
  type Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { sendMessage } from '../shared/queue';
import { BulkheadInterceptor, RETRY_AFTER_SECONDS } from './bulkhead.interceptor';
import { DbPools } from './db-pools';
import { CrmMetrics } from './metrics';
import { TenantBulkhead, type Compartment, type CompartmentLimits } from './tenant-bulkhead';

export interface CrmConfig {
  mode: 'truoc' | 'sau';
  databaseUrl: string;
  reportSeconds: number;
  limits?: Partial<Record<Compartment, Partial<CompartmentLimits>>>;
  poolSizes?: { interactive: number; report: number };
}

const CRM_CONFIG = Symbol('CRM_CONFIG');

const TRUOC_POOL_SIZE = 20;
const DEFAULT_POOLS = { interactive: 14, report: 4 };

@Controller()
class CrmController {
  constructor(
    @Inject(DbPools) private readonly pools: DbPools,
    @Inject(CRM_CONFIG) private readonly config: CrmConfig,
    @Inject(CrmMetrics) private readonly metrics: CrmMetrics,
  ) {}

  /** Thao tác tương tác: ngắn, dùng kết nối của khoang tương tác. */
  @Post('notes')
  async addNote(@Headers('x-tenant-id') tenantId: string, @Body() body: { body: string }) {
    const { rows } = await this.pools.interactive.query(
      'INSERT INTO crm.notes (tenant_id, body) VALUES ($1, $2) RETURNING id',
      [tenantId, body.body],
    );
    return rows[0];
  }

  /** Báo cáo pipeline: chậm có chủ đích, giữ một kết nối suốt thời gian chạy. */
  @Get('reports/pipeline')
  async report(@Headers('x-tenant-id') tenantId: string) {
    const { rows } = await this.pools.report.query(
      'SELECT count(*)::int AS deals, sum(amount_vnd)::text AS total_vnd, pg_sleep($2) IS NULL AS held FROM crm.deals WHERE tenant_id = $1',
      [tenantId, this.config.reportSeconds],
    );
    return rows[0];
  }

  @Post('exports')
  @HttpCode(200)
  async requestExport(@Headers('x-tenant-id') tenantId: string, @Res({ passthrough: true }) reply: { status(code: number): void }) {
    const exportId = randomUUID();
    if (this.config.mode === 'truoc') {
      await this.pools.report.query('SELECT pg_sleep($1)', [this.config.reportSeconds]);
      return { exportId, status: 'DONE' };
    }
    // [PATTERN] Việc dài ra khỏi request: API ghi yêu cầu và trả ngay, worker làm với concurrency cố định.
    const client = await this.pools.interactive.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO crm.exports (id, tenant_id, status) VALUES ($1, $2, 'PENDING')", [exportId, tenantId]);
      await sendMessage(client, 'exports', { exportId });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    reply.status(202);
    return { exportId, status: 'PENDING' };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  scrape() {
    return this.metrics.registry.metrics();
  }
}

@Module({})
export class CrmModule {
  /** Bulkhead dùng cho test soi trạng thái chỗ; nhận từ ngoài để test giữ được tham chiếu. */
  static register(config: CrmConfig, bulkhead = createBulkhead(config)): DynamicModule {
    const guarded: Provider[] =
      config.mode === 'sau'
        ? [
            { provide: TenantBulkhead, useValue: bulkhead },
            {
              provide: RETRY_AFTER_SECONDS,
              useValue: { interactive: 1, report: Math.max(1, Math.ceil(config.reportSeconds)) },
            },
            { provide: APP_INTERCEPTOR, useClass: BulkheadInterceptor },
          ]
        : [];
    return {
      module: CrmModule,
      controllers: [CrmController],
      providers: [
        ...guarded,
        { provide: CRM_CONFIG, useValue: config },
        { provide: CrmMetrics, useValue: new CrmMetrics() },
        {
          provide: DbPools,
          useFactory: () =>
            config.mode === 'sau'
              ? DbPools.compartments(config.databaseUrl, config.poolSizes ?? DEFAULT_POOLS)
              : DbPools.shared(config.databaseUrl, TRUOC_POOL_SIZE),
        },
      ],
    };
  }
}

export function createBulkhead(config: Pick<CrmConfig, 'limits' | 'reportSeconds'>): TenantBulkhead {
  return new TenantBulkhead({
    interactive: { perTenant: 4, queue: 8, maxWaitMs: 200, ...config.limits?.interactive },
    report: { perTenant: 1, queue: 3, maxWaitMs: config.reportSeconds * 4_000, ...config.limits?.report },
  });
}
