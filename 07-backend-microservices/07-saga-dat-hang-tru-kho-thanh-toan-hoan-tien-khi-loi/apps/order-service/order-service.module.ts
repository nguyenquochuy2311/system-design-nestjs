import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../../libs/platform/database';
import { archiveMessage, QueueConsumer, sendMessage } from '../../libs/platform/queue';
import { decide, type SagaCommand, type SagaEvent, type SagaState } from './saga-machine';

export interface OrderServiceConfig {
  databaseUrl: string;
  deadlineSeconds: number;
  pollMs: number;
}

const ORDER_CONFIG = Symbol('ORDER_CONFIG');

interface PlaceOrder {
  sku: string;
  quantity: number;
  amountVnd: number;
}

interface Reply {
  type: SagaEvent;
  sagaId: string;
}

const TERMINAL_ORDER_STATUS: Partial<Record<SagaState, string>> = { CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' };

@Injectable()
class SagaOrchestrator implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly consumer: QueueConsumer<Reply>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ORDER_CONFIG) private readonly config: OrderServiceConfig,
  ) {
    this.consumer = new QueueConsumer(
      db,
      { service: 'order-service', queue: 'saga_replies', visibilitySeconds: 2, batchSize: 50, pollMs: config.pollMs },
      (msgId, reply) => this.onReply(msgId, reply),
    );
  }

  onApplicationBootstrap(): void {
    this.consumer.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.consumer.stop();
  }

  /** Bắt đầu saga: đơn, trạng thái, lệnh đầu tiên và hạn chót cùng commit, nên không có đơn nào rơi ra ngoài quy trình. */
  start(command: PlaceOrder) {
    const sagaId = randomUUID();
    return this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO ordering.orders (id, sku, quantity, amount_vnd, status) VALUES ($1, $2, $3, $4, 'PENDING')",
        [sagaId, command.sku, command.quantity, command.amountVnd],
      );
      await tx.query("INSERT INTO ordering.order_sagas (saga_id, state) VALUES ($1, 'RESERVING')", [sagaId]);
      await tx.query(
        "INSERT INTO ordering.order_saga_transitions (saga_id, to_state, event) VALUES ($1, 'RESERVING', 'OrderPlaced')",
        [sagaId],
      );
      await sendMessage(tx, 'inventory_commands', {
        type: 'ReserveStock',
        sagaId,
        sku: command.sku,
        quantity: command.quantity,
      });
      await sendMessage(tx, 'saga_replies', { type: 'DeadlineReached', sagaId }, this.config.deadlineSeconds);
      return { orderId: sagaId, status: 'PENDING' };
    });
  }

  private onReply(msgId: number, reply: Reply): Promise<void> {
    return this.db.transaction(async (tx) => {
      await this.advance(tx, reply);
      await archiveMessage(tx, 'saga_replies', msgId);
    });
  }

  private async advance(tx: PoolClient, reply: Reply): Promise<void> {
    const { rows } = await tx.query<{ state: SagaState; version: number }>(
      'SELECT state, version FROM ordering.order_sagas WHERE saga_id = $1',
      [reply.sagaId],
    );
    const saga = rows[0];
    const decision = saga && decide(saga.state, reply.type);
    if (!saga || !decision) {
      return;
    }
    // [PATTERN] Khóa lạc quan: hai trả lời cùng đọc một phiên bản thì chỉ một bên đẩy được trạng thái, bên kia đọc lại sau.
    const updated = await tx.query(
      'UPDATE ordering.order_sagas SET state = $3, version = version + 1, updated_at = clock_timestamp() WHERE saga_id = $1 AND version = $2',
      [reply.sagaId, saga.version, decision.next],
    );
    if (updated.rowCount === 0) {
      throw new Error(`Saga ${reply.sagaId} vừa đổi phiên bản`);
    }
    await tx.query(
      'INSERT INTO ordering.order_saga_transitions (saga_id, from_state, to_state, event) VALUES ($1, $2, $3, $4)',
      [reply.sagaId, saga.state, decision.next, reply.type],
    );
    const orderStatus = TERMINAL_ORDER_STATUS[decision.next];
    if (orderStatus) {
      await tx.query('UPDATE ordering.orders SET status = $2 WHERE id = $1', [reply.sagaId, orderStatus]);
    }
    if (decision.command) {
      await this.dispatch(tx, decision.command, reply.sagaId);
    }
  }

  // [PATTERN] Đổi trạng thái và gửi lệnh trong cùng transaction: crash ở bất kỳ đâu cũng không có trạng thái mới mà thiếu lệnh.
  private async dispatch(tx: PoolClient, command: SagaCommand, sagaId: string): Promise<void> {
    if (command === 'ReleaseStock') {
      await sendMessage(tx, 'inventory_commands', { type: 'ReleaseStock', sagaId });
      return;
    }
    const { rows } = await tx.query<{ amount_vnd: number }>('SELECT amount_vnd FROM ordering.orders WHERE id = $1', [sagaId]);
    await sendMessage(tx, 'payment_commands', { type: command, sagaId, amountVnd: rows[0]?.amount_vnd });
  }
}

@Controller('orders')
class OrderController {
  constructor(
    @Inject(SagaOrchestrator) private readonly saga: SagaOrchestrator,
    @Inject(Database) private readonly db: Database,
  ) {}

  /** Trả 202 ngay: đơn đang xử lý, khách không phải chờ cả quy trình. */
  @Post()
  @HttpCode(202)
  place(@Body() body: PlaceOrder) {
    if (!body.sku || !Number.isInteger(body.quantity) || !Number.isInteger(body.amountVnd)) {
      throw new BadRequestException('Đơn không hợp lệ');
    }
    return this.saga.start(body);
  }

  /** Trả lời "đơn X đang ở bước nào, vì sao" từ dữ liệu của saga. */
  @Get(':id')
  async get(@Param('id') id: string) {
    const { rows } = await this.db.query<{ status: string; state: string }>(
      `SELECT o.status, s.state FROM ordering.orders o JOIN ordering.order_sagas s ON s.saga_id = o.id WHERE o.id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Không có đơn ${id}`);
    }
    const history = await this.db.query(
      'SELECT from_state, to_state, event, at FROM ordering.order_saga_transitions WHERE saga_id = $1 ORDER BY id',
      [id],
    );
    return { ...rows[0], history: history.rows };
  }
}

@Module({})
export class OrderServiceModule {
  static register(config: OrderServiceConfig): DynamicModule {
    return {
      module: OrderServiceModule,
      controllers: [OrderController],
      providers: [
        SagaOrchestrator,
        { provide: ORDER_CONFIG, useValue: config },
        { provide: Database, useFactory: () => new Database(config.databaseUrl) },
      ],
    };
  }
}
