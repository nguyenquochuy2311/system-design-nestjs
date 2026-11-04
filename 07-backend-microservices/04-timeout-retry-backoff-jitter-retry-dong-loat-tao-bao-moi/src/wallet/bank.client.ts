import { setTimeout as sleep } from 'node:timers/promises';
import { DelegateBackoff, handleWhen, retry, type IRetryBackoffContext, type RetryPolicy } from 'cockatiel';
import { Pool } from 'undici';
import { BankError, retryReason } from './error-classifier';
import type { WalletMetrics } from './metrics';
import type { RetryBudget } from './retry-budget';

export const BANK_CLIENT = Symbol('BANK_CLIENT');

export interface TopUpCommand {
  topupId: string;
  amountVnd: number;
}

export type TopUpOutcome = 'completed' | 'unknown' | 'rejected';

export interface BankClient {
  topUp(command: TopUpCommand): Promise<TopUpOutcome>;
}

export interface RetrySettings {
  attemptTimeoutMs: number;
  totalTimeoutMs: number;
  connectTimeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetrySettings = {
  attemptTimeoutMs: 3_000,
  // Ràng buộc 5 giây ở p99: tổng thời gian kể cả retry phải dừng trước đó, không phải tổng của các lần thử.
  totalTimeoutMs: 4_800,
  connectTimeoutMs: 1_000,
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
};

const POOL_CONNECTIONS = 200;

function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

async function postTransfer(
  pool: Pool,
  command: TopUpCommand,
  options: { idempotencyKey?: string; signal?: AbortSignal; headersTimeout?: number },
): Promise<void> {
  const { statusCode, headers, body } = await pool.request({
    path: '/transfers',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    body: JSON.stringify({ reference: command.topupId, amountVnd: command.amountVnd }),
    signal: options.signal,
    headersTimeout: options.headersTimeout,
  });
  await body.dump();
  if (statusCode !== 200) {
    throw new BankError(statusCode, parseRetryAfter(headers['retry-after']));
  }
}

/** Bản "trước": không timeout, chờ cố định 1 giây, retry mọi lỗi, không có Idempotency-Key. */
export class NaiveBankClient implements BankClient {
  private readonly pool: Pool;

  constructor(bankUrl: string) {
    this.pool = new Pool(bankUrl, { connections: POOL_CONNECTIONS, headersTimeout: 0, bodyTimeout: 0 });
  }

  async topUp(command: TopUpCommand): Promise<TopUpOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await postTransfer(this.pool, command, { headersTimeout: 0 });
        return 'completed';
      } catch (error) {
        if (attempt === 3) {
          throw error;
        }
        await sleep(1_000);
      }
    }
  }

  close(): Promise<void> {
    return this.pool.destroy();
  }
}

/** [PATTERN] Full Jitter: chờ ngẫu nhiên trên cả khoảng 0..min(cap, base * 2^n), để các client không retry cùng lúc. */
export function fullJitterDelay(attempt: number, settings: RetrySettings, random = Math.random): number {
  return random() * Math.min(settings.maxDelayMs, settings.baseDelayMs * 2 ** (attempt - 1));
}

/** Bản "sau": timeout hai lớp, retry có giới hạn và ngân sách, Full Jitter, và cùng một key ở mọi lần thử. */
export class ResilientBankClient implements BankClient {
  private readonly pool: Pool;
  private readonly policy: RetryPolicy;

  constructor(
    bankUrl: string,
    private readonly settings: RetrySettings,
    private readonly budget: RetryBudget,
    private readonly metrics: WalletMetrics,
  ) {
    this.pool = new Pool(bankUrl, {
      connections: POOL_CONNECTIONS,
      connect: { timeout: settings.connectTimeoutMs },
    });
    this.policy = retry(
      handleWhen((error) => this.shouldRetry(error)),
      {
        maxAttempts: settings.maxRetries,
        backoff: new DelegateBackoff((context: IRetryBackoffContext<unknown>) => this.backoffMs(context)),
      },
    );
    // Tiêu token ở đây chứ không ở bộ lọc: cockatiel gọi bộ lọc cả ở lần lỗi cuối, lúc không còn retry nữa.
    this.policy.onRetry((event) => {
      this.budget.spend();
      if ('error' in event) {
        this.metrics.retries.inc({ reason: retryReason(event.error) });
      }
    });
  }

  private shouldRetry(error: unknown): boolean {
    if (retryReason(error) === undefined) {
      return false;
    }
    if (!this.budget.hasToken()) {
      this.metrics.budgetExhausted.inc();
      return false;
    }
    return true;
  }

  private backoffMs(context: IRetryBackoffContext<unknown>): number {
    const failure = context.result;
    // Đối tác đã nói rõ chờ bao lâu thì nghe theo, không tự tính.
    if ('error' in failure && failure.error instanceof BankError && failure.error.retryAfterMs !== undefined) {
      return failure.error.retryAfterMs;
    }
    return fullJitterDelay(context.attempt, this.settings);
  }

  async topUp(command: TopUpCommand): Promise<TopUpOutcome> {
    this.budget.recordRequest();
    const deadline = AbortSignal.timeout(this.settings.totalTimeoutMs);
    try {
      await this.policy.execute(
        () =>
          postTransfer(this.pool, command, {
            // [PATTERN] Cùng một key ở mọi lần thử, nên retry sau khi đối tác đã ghi không tạo giao dịch thứ hai.
            idempotencyKey: command.topupId,
            // Timeout mỗi lần thử và hạn chót của cả lệnh đều hủy hẳn lời gọi, trả kết nối về pool.
            signal: AbortSignal.any([deadline, AbortSignal.timeout(this.settings.attemptTimeoutMs)]),
          }),
        deadline,
      );
      return 'completed';
    } catch (error) {
      if (error instanceof BankError && retryReason(error) === undefined) {
        return 'rejected';
      }
      // Hết lượt hoặc hết hạn: có thể đối tác đã ghi, nên kết quả là "chưa biết" chứ không phải "thất bại".
      return 'unknown';
    }
  }

  /** Đối soát gửi lại đúng một lần với cùng key; nhịp gửi do hàng đợi đối soát quyết định, nên không retry ở đây. */
  async resend(command: TopUpCommand): Promise<'completed' | 'rejected' | 'unavailable'> {
    try {
      await postTransfer(this.pool, command, {
        idempotencyKey: command.topupId,
        signal: AbortSignal.timeout(this.settings.attemptTimeoutMs),
      });
      return 'completed';
    } catch (error) {
      return error instanceof BankError && retryReason(error) === undefined ? 'rejected' : 'unavailable';
    }
  }

  /** Hỏi trạng thái theo key. */
  async lookup(topupId: string): Promise<'found' | 'not_found' | 'unavailable'> {
    try {
      const { statusCode, body } = await this.pool.request({
        path: `/transfers/${topupId}`,
        method: 'GET',
        signal: AbortSignal.timeout(this.settings.attemptTimeoutMs),
      });
      await body.dump();
      if (statusCode === 200) {
        return 'found';
      }
      return statusCode === 404 ? 'not_found' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  close(): Promise<void> {
    return this.pool.destroy();
  }
}
