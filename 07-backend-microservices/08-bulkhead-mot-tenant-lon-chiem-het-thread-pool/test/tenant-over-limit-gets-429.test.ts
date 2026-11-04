import { afterEach, describe, expect, it } from 'vitest';
import { Crm, REPORT_SECONDS, sleep } from './support/stack';

describe('Tenant vượt giới hạn đồng thời', () => {
  let crm: Crm;

  afterEach(() => crm.stop());

  it('nhận 429 kèm Retry-After, tenant khác vẫn chạy được', async () => {
    crm = await new Crm({ mode: 'sau' }).start();

    const overloaded = Array.from({ length: 10 }, () => crm.report('T-1'));
    await sleep(30);
    // Gọi trong lúc T-1 còn đang đầy khoang: chỉ khi đồng thời mới có tranh chấp để kiểm.
    const other = await crm.report('T-2');
    const replies = await Promise.all(overloaded);
    const rejected = replies.filter((reply) => reply.status === 429);

    expect(other.status).toBe(200);
    expect(other.ms).toBeLessThan(REPORT_SECONDS * 1_000 * 2);
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(4);
    expect(rejected).toHaveLength(6);
    expect(rejected[0]?.retryAfter).toBe('1');
  });

  it('một tenant không chiếm được quá giới hạn trong khoang tương tác', async () => {
    crm = await new Crm({
      mode: 'sau',
      limits: { interactive: { perTenant: 1, queue: 0, maxWaitMs: 10 } },
    }).start();

    const replies = await Promise.all(Array.from({ length: 30 }, () => crm.note('T-1')));

    expect(replies.some((reply) => reply.status === 429)).toBe(true);
    expect(replies.some((reply) => reply.status === 201)).toBe(true);
  });
});
