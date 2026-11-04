import { describe, expect, it } from 'vitest';
import { BulkheadFullError, TenantBulkhead } from '../src/crm-api/tenant-bulkhead';
import { sleep } from './support/stack';

const limits = { perTenant: 1, queue: 1, maxWaitMs: 50 };
const bulkhead = () => new TenantBulkhead({ interactive: limits, report: limits });

describe('Semaphore theo khoang và tenant', () => {
  it('vượt chỗ thì vào hàng chờ, có chỗ thì được cấp theo thứ tự', async () => {
    const subject = bulkhead();
    const first = await subject.acquire('report', 'A');

    const second = subject.acquire('report', 'A');
    first.release();

    expect((await second).waitedMs).toBeGreaterThanOrEqual(0);
    expect(subject.inUse('report', 'A')).toBe(1);
  });

  it('hàng chờ đầy thì từ chối ngay', async () => {
    const subject = bulkhead();
    const first = await subject.acquire('report', 'A');
    const queued = subject.acquire('report', 'A').catch(() => undefined);
    const startedAt = performance.now();

    await expect(subject.acquire('report', 'A')).rejects.toBeInstanceOf(BulkheadFullError);

    // Từ chối ngay, không phải chờ hết hạn: không có giới hạn hàng chờ thì request vẫn bị từ chối, nhưng sau maxWaitMs.
    expect(performance.now() - startedAt).toBeLessThan(limits.maxWaitMs / 2);
    first.release();
    await queued;
  });

  it('chờ quá hạn thì bị từ chối đúng lúc, không chờ tới khi có chỗ', async () => {
    const subject = bulkhead();
    await subject.acquire('report', 'A');
    const startedAt = performance.now();

    await expect(subject.acquire('report', 'A')).rejects.toBeInstanceOf(BulkheadFullError);

    expect(performance.now() - startedAt).toBeLessThan(150);
  });

  it('tenant khác và khoang khác không bị ảnh hưởng', async () => {
    const subject = bulkhead();
    await subject.acquire('report', 'A');

    await expect(subject.acquire('report', 'B')).resolves.toBeDefined();
    await expect(subject.acquire('interactive', 'A')).resolves.toBeDefined();
  });

  it('trả chỗ hai lần không làm âm số chỗ', async () => {
    const subject = bulkhead();
    const lease = await subject.acquire('report', 'A');
    const other = await subject.acquire('report', 'B');

    lease.release();
    lease.release();

    expect(subject.inUse('report', 'A')).toBe(0);
    expect(subject.inUse('report', 'B')).toBe(1);
    other.release();
  });

  it('request hết hạn trong hàng không chiếm chỗ của request sau', async () => {
    const subject = bulkhead();
    const first = await subject.acquire('report', 'A');
    await subject.acquire('report', 'A').catch(() => undefined);
    await sleep(10);

    const third = subject.acquire('report', 'A');
    first.release();

    await expect(third).resolves.toBeDefined();
  });
});
