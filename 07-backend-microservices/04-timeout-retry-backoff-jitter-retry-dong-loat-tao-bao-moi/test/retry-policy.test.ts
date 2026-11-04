import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RETRY, fullJitterDelay } from '../src/wallet/bank.client';
import { BankError, retryReason } from '../src/wallet/error-classifier';
import { RetryBudget } from '../src/wallet/retry-budget';
import { FAST_RETRY, Lab } from './support/stack';

describe('Phân loại lỗi', () => {
  it('chỉ lỗi thoáng qua mới được retry', () => {
    expect(retryReason(new BankError(503))).toBe('overloaded');
    expect(retryReason(new BankError(429, 1_000))).toBe('rate_limited');
    expect(retryReason({ name: 'TimeoutError' })).toBe('timeout');
    expect(retryReason({ code: 'ECONNRESET' })).toBe('connection');
    expect(retryReason(new BankError(400))).toBeUndefined();
    expect(retryReason(new BankError(500))).toBeUndefined();
    expect(retryReason(new BankError(429))).toBeUndefined();
  });
});

describe('Full Jitter', () => {
  it('thời gian chờ nằm trên cả khoảng 0..min(cap, base * 2^n)', () => {
    expect(fullJitterDelay(1, DEFAULT_RETRY, () => 0)).toBe(0);
    expect(fullJitterDelay(1, DEFAULT_RETRY, () => 0.999)).toBeCloseTo(199.8);
    expect(fullJitterDelay(3, DEFAULT_RETRY, () => 0.5)).toBe(400);
  });

  it('không vượt cap dù số lần thử lớn', () => {
    expect(fullJitterDelay(20, DEFAULT_RETRY, () => 0.999)).toBeLessThan(DEFAULT_RETRY.maxDelayMs);
  });
});

describe('Ngân sách retry', () => {
  it('hết token thì từ chối, và chỉ hồi lại theo lưu lượng mới', () => {
    const budget = new RetryBudget(0.1, 2);
    budget.spend();
    budget.spend();
    expect(budget.hasToken()).toBe(false);
    for (let i = 0; i < 9; i += 1) {
      budget.recordRequest();
    }
    expect(budget.hasToken()).toBe(false);
    budget.recordRequest();
    expect(budget.hasToken()).toBe(true);
  });

  it('về lâu dài retry không vượt tỷ lệ đã đặt', () => {
    const budget = new RetryBudget(0.1, 5);
    let retries = 0;
    for (let i = 0; i < 1_000; i += 1) {
      budget.recordRequest();
      if (budget.hasToken()) {
        budget.spend();
        retries += 1;
      }
    }
    expect(retries).toBeLessThanOrEqual(5 + 100);
  });
});

describe('Lời gọi tới đối tác', () => {
  let lab: Lab;

  afterEach(() => lab.stop());

  it('sau: lỗi 400 không retry', async () => {
    lab = await Lab.start({ mode: 'sau' });

    const reply = await lab.topUp(-1);

    expect(reply.status).toBe(422);
    expect(lab.attempts()).toBe(1);
  });

  it('sau: 503 retry tối đa 3 lần rồi trả "đang xử lý"', async () => {
    lab = await Lab.start({ mode: 'sau' });
    lab.bank.behavior.errorRate = 1;

    const reply = await lab.topUp();

    expect(lab.attempts()).toBe(1 + FAST_RETRY.maxRetries);
    expect(reply.status).toBe(202);
    expect(reply.body.status).toBe('PENDING');
  });

  it('sau: lỗi lẻ được retry qua, khách không thấy lỗi', async () => {
    lab = await Lab.start({ mode: 'sau', budget: { ratio: 0.1, capacity: 200 } });
    lab.bank.behavior.errorRate = 0.05;
    lab.bank.behavior.capacityRps = 100_000;

    const replies = await Promise.all(Array.from({ length: 200 }, () => lab.topUp()));

    expect(replies.filter((reply) => reply.status === 200).length).toBeGreaterThanOrEqual(199);
  });

  it('sau: 429 có Retry-After thì chờ đúng thời gian đối tác yêu cầu', async () => {
    lab = await Lab.start({ mode: 'sau', retry: { ...FAST_RETRY, totalTimeoutMs: 3_000 } });
    lab.bank.behavior.retryAfterSeconds = 1;

    await lab.topUp();

    const [times] = [...lab.bank.attemptsByReference.values()];
    expect((times?.[1] ?? 0) - (times?.[0] ?? 0)).toBeGreaterThanOrEqual(990);
  });

  it('sau: hết ngân sách thì fail-fast, không đổ thêm tải vào đối tác', async () => {
    lab = await Lab.start({ mode: 'sau', budget: { ratio: 0.1, capacity: 1 } });
    lab.bank.behavior.errorRate = 1;

    await Promise.all(Array.from({ length: 20 }, () => lab.topUp()));

    expect(lab.attempts()).toBeLessThanOrEqual(20 + 3);
    expect(await lab.metrics()).toMatch(/bank_retry_budget_exhausted_total [1-9]/);
  });

  it('sau: có counter retry theo nguyên nhân', async () => {
    lab = await Lab.start({ mode: 'sau' });
    lab.bank.behavior.errorRate = 1;

    await lab.topUp();

    expect(await lab.metrics()).toContain('bank_retries_total{reason="overloaded"} 3');
  });

  it('sau: đối tác treo thì lệnh kết thúc trước hạn chót tổng, không treo theo', async () => {
    lab = await Lab.start({ mode: 'sau' });
    lab.bank.behavior.latencyMs = 5_000;

    const reply = await lab.topUp();

    expect(reply.ms).toBeLessThan(FAST_RETRY.totalTimeoutMs + 200);
    expect(reply.status).toBe(202);
  });

  it('trước: chờ cố định 1 giây và retry cả lỗi xác định', async () => {
    lab = await Lab.start({ mode: 'truoc' });

    await lab.topUp(-1);

    expect(lab.attempts()).toBe(4);
    const [times] = [...lab.bank.attemptsByReference.values()];
    expect((times?.[1] ?? 0) - (times?.[0] ?? 0)).toBeGreaterThanOrEqual(990);
  });
});
