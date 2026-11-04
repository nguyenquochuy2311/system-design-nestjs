import { afterEach, describe, expect, it } from 'vitest';
import { Crm } from './support/stack';

describe('Trả chỗ trong khoang', () => {
  let crm: Crm;

  afterEach(() => crm.stop());

  it('request xong thì chỗ được trả', async () => {
    crm = await new Crm({ mode: 'sau' }).start();

    await crm.report('T-1');

    expect(crm.bulkhead.inUse('report', 'T-1')).toBe(0);
  });

  it('handler lỗi vẫn trả chỗ, khoang không rò rỉ dần tới đầy', async () => {
    crm = await new Crm({ mode: 'sau' }).start();

    const failures = [];
    for (let i = 0; i < 10; i += 1) {
      failures.push(
        await fetch(`${crm.url}/notes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': 'T-1' },
          body: '{}',
        }),
      );
    }

    expect(failures.every((reply) => reply.status === 500)).toBe(true);
    expect(crm.bulkhead.inUse('interactive', 'T-1')).toBe(0);
    expect((await crm.note('T-1')).status).toBe(201);
  });
});
