import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
  UnprocessableEntityException,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  BANK_CLIENT,
  DEFAULT_RETRY,
  NaiveBankClient,
  ResilientBankClient,
  type BankClient,
  type RetrySettings,
} from './bank.client';
import { WalletMetrics } from './metrics';
import { DEFAULT_RECONCILE, ReconcileWorker, type ReconcileSettings, type TopUpStatus } from './reconcile.worker';
import { RetryBudget } from './retry-budget';

export interface WalletConfig {
  mode: 'truoc' | 'sau';
  bankUrl: string;
  retry?: Partial<RetrySettings>;
  reconcile?: Partial<ReconcileSettings>;
  budget?: { ratio: number; capacity: number };
}

const TOPUP_STATUSES = Symbol('TOPUP_STATUSES');
type TopUpStatuses = Map<string, TopUpStatus>;

interface StatusReply {
  status(code: number): void;
}

@Injectable()
class WalletLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(BANK_CLIENT) private readonly bank: BankClient & { close(): Promise<void> },
    @Inject(ReconcileWorker) private readonly reconcile: ReconcileWorker | null,
  ) {}

  onApplicationBootstrap(): void {
    this.reconcile?.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.reconcile?.stop();
    await this.bank.close();
  }
}

@Controller()
class WalletController {
  constructor(
    @Inject(BANK_CLIENT) private readonly bank: BankClient,
    @Inject(ReconcileWorker) private readonly reconcile: ReconcileWorker | null,
    @Inject(TOPUP_STATUSES) private readonly statuses: TopUpStatuses,
    @Inject(WalletMetrics) private readonly metrics: WalletMetrics,
  ) {}

  @Post('topups')
  @HttpCode(200)
  async topUp(@Body() body: { amountVnd: number }, @Res({ passthrough: true }) reply: StatusReply) {
    if (!Number.isInteger(body.amountVnd)) {
      throw new BadRequestException('amountVnd phải là số nguyên');
    }
    const topupId = randomUUID();
    const outcome = await this.call(topupId, body.amountVnd);
    this.metrics.topups.inc({ result: outcome === 'unknown' ? 'pending' : outcome });
    if (outcome === 'rejected') {
      throw new UnprocessableEntityException('Đối tác từ chối lệnh nạp');
    }
    if (outcome === 'unknown') {
      // Nghiệp vụ cho phép "đang xử lý" và hoàn tất sau bằng đối soát.
      this.statuses.set(topupId, 'PENDING');
      this.reconcile?.enqueue({ topupId, amountVnd: body.amountVnd });
      reply.status(202);
      return { topupId, status: 'PENDING' };
    }
    this.statuses.set(topupId, 'COMPLETED');
    return { topupId, status: 'COMPLETED' };
  }

  private async call(topupId: string, amountVnd: number) {
    try {
      return await this.bank.topUp({ topupId, amountVnd });
    } catch (error) {
      this.metrics.topups.inc({ result: 'failed' });
      throw new BadGatewayException('Không nạp được tiền', { cause: error });
    }
  }

  @Get('topups/:id')
  status(@Param('id') id: string) {
    const status = this.statuses.get(id);
    if (!status) {
      throw new NotFoundException(`Không có lệnh ${id}`);
    }
    return { topupId: id, status };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  scrape() {
    this.metrics.reconcileDepth.set(this.reconcile?.depth ?? 0);
    return this.metrics.registry.metrics();
  }
}

@Module({})
export class WalletModule {
  static register(config: WalletConfig): DynamicModule {
    const metrics = new WalletMetrics();
    const statuses: TopUpStatuses = new Map();
    const resilient =
      config.mode === 'sau'
        ? new ResilientBankClient(
            config.bankUrl,
            { ...DEFAULT_RETRY, ...config.retry },
            new RetryBudget(config.budget?.ratio, config.budget?.capacity),
            metrics,
          )
        : undefined;
    const reconcile = resilient
      ? new ReconcileWorker(
          (topupId) => resilient.lookup(topupId),
          (command) => resilient.resend(command),
          { ...DEFAULT_RECONCILE, ...config.reconcile },
          (topupId, status) => {
            statuses.set(topupId, status);
            metrics.reconciled.inc({ status });
          },
        )
      : null;
    return {
      module: WalletModule,
      controllers: [WalletController],
      providers: [
        WalletLifecycle,
        { provide: WalletMetrics, useValue: metrics },
        { provide: TOPUP_STATUSES, useValue: statuses },
        { provide: ReconcileWorker, useValue: reconcile },
        { provide: BANK_CLIENT, useValue: resilient ?? new NaiveBankClient(config.bankUrl) },
      ],
    };
  }
}
