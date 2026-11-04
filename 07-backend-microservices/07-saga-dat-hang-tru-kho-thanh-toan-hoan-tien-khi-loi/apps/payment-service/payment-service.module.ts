import { Inject, Injectable, Module, type DynamicModule, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Database } from '../../libs/platform/database';
import { archiveMessage, QueueConsumer, sendMessage } from '../../libs/platform/queue';
import { GatewayClient } from './gateway.client';

export interface PaymentServiceConfig {
  databaseUrl: string;
  gatewayUrl: string;
  gatewayTimeoutMs: number;
  pollMs: number;
  visibilitySeconds: number;
}

const PAYMENT_CONFIG = Symbol('PAYMENT_CONFIG');

interface PaymentCommand {
  type: 'ChargePayment' | 'VoidPayment';
  sagaId: string;
  amountVnd: number;
}

@Injectable()
class PaymentHandlers implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly consumer: QueueConsumer<PaymentCommand>;
  private readonly gateway: GatewayClient;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PAYMENT_CONFIG) config: PaymentServiceConfig,
  ) {
    this.gateway = new GatewayClient(config.gatewayUrl, config.gatewayTimeoutMs);
    this.consumer = new QueueConsumer(
      db,
      {
        service: 'payment-service',
        queue: 'payment_commands',
        visibilitySeconds: config.visibilitySeconds,
        batchSize: 50,
        pollMs: config.pollMs,
      },
      (msgId, command) => this.onCommand(msgId, command),
    );
  }

  onApplicationBootstrap(): void {
    this.consumer.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.consumer.stop();
  }

  // Cổng là bên ngoài nên không nằm trong transaction. Crash sau khi cổng đã trừ thì lệnh hiện lại và gửi lại cùng key,
  // cổng trả đúng kết quả cũ. Key là mã saga.
  private async onCommand(msgId: number, command: PaymentCommand): Promise<void> {
    const { sagaId, amountVnd } = command;
    let replyType: string;
    let status: string;
    if (command.type === 'ChargePayment') {
      const outcome = await this.gateway.charge(sagaId, amountVnd);
      replyType = outcome === 'captured' ? 'PaymentSucceeded' : 'PaymentFailed';
      status = outcome === 'captured' ? 'CAPTURED' : 'DECLINED';
    } else {
      status = await this.gateway.void(sagaId);
      replyType = 'PaymentVoided';
    }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payment.payments (saga_id, status, amount_vnd) VALUES ($1, $2, $3)
         ON CONFLICT (saga_id) DO UPDATE SET status = EXCLUDED.status`,
        [sagaId, status, amountVnd],
      );
      await sendMessage(tx, 'saga_replies', { type: replyType, sagaId });
      await archiveMessage(tx, 'payment_commands', msgId);
    });
  }
}

@Module({})
export class PaymentServiceModule {
  static register(config: PaymentServiceConfig): DynamicModule {
    return {
      module: PaymentServiceModule,
      providers: [
        PaymentHandlers,
        { provide: PAYMENT_CONFIG, useValue: config },
        { provide: Database, useFactory: () => new Database(config.databaseUrl) },
      ],
    };
  }
}
