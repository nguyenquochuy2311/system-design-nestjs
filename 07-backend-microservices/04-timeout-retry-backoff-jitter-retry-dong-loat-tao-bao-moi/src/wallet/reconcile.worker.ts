import { setTimeout as sleep } from 'node:timers/promises';
import { logEvent } from '../shared/log';

export type TopUpStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

export interface PendingCommand {
  topupId: string;
  amountVnd: number;
}

interface PendingTopUp extends PendingCommand {
  enqueuedAt: number;
}

export interface ReconcileSettings {
  /** Khoảng cách giữa hai lệnh: đối soát cũng là tải vào đối tác, nên phải có nhịp cố định chứ không dồn cả lô. */
  intervalMs: number;
  /** Vẫn chưa xong sau chừng này thời gian thì đánh dấu thất bại để con người xử lý. */
  giveUpAfterMs: number;
}

export const DEFAULT_RECONCILE: ReconcileSettings = { intervalMs: 200, giveUpAfterMs: 300_000 };

type Lookup = (topupId: string) => Promise<'found' | 'not_found' | 'unavailable'>;
type Resend = (command: PendingCommand) => Promise<'completed' | 'rejected' | 'unavailable'>;

/** Hàng đợi đối soát trong bộ nhớ, đủ cho lab; thật thì phải bền, tiến trình chết là mất danh sách (xem 14/03). */
export class ReconcileWorker {
  private readonly queue: PendingTopUp[] = [];
  private running = false;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly lookup: Lookup,
    private readonly resend: Resend,
    private readonly settings: ReconcileSettings,
    private readonly onSettled: (topupId: string, status: TopUpStatus) => void,
  ) {}

  enqueue(command: PendingCommand): void {
    this.queue.push({ ...command, enqueuedAt: Date.now() });
  }

  get depth(): number {
    return this.queue.length;
  }

  start(): void {
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      await sleep(this.settings.intervalMs);
      const item = this.queue.shift();
      if (item) {
        await this.check(item);
      }
    }
  }

  private async check(item: PendingTopUp): Promise<void> {
    const found = await this.lookup(item.topupId);
    if (found === 'found') {
      this.onSettled(item.topupId, 'COMPLETED');
      return;
    }
    if (Date.now() - item.enqueuedAt > this.settings.giveUpAfterMs) {
      this.onSettled(item.topupId, 'FAILED');
      logEvent({ service: 'wallet', event: 'topup_reconcile_failed', topupId: item.topupId });
      return;
    }
    // [PATTERN] Đối tác chưa có giao dịch thì gửi lại cùng key. Chỉ hỏi mà không gửi thì lệnh chưa từng tới đối tác sẽ thất
    // bại hết; cùng key nên dù lệnh gốc còn trên đường cũng chỉ tạo một giao dịch.
    const resent = found === 'not_found' ? await this.resend(item) : 'unavailable';
    if (resent === 'unavailable') {
      this.queue.push(item);
    } else {
      this.onSettled(item.topupId, resent === 'completed' ? 'COMPLETED' : 'FAILED');
    }
  }
}
