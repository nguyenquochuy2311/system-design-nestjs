import { afterEach, describe, expect, it } from 'vitest';
import { Lab, waitUntil } from './support/stack';

describe('Phản hồi mất sau khi đối tác đã ghi giao dịch', () => {
  let lab: Lab;

  afterEach(() => lab.stop());

  it('trước: retry không có key tạo giao dịch trùng', async () => {
    lab = await Lab.start({ mode: 'truoc' });
    lab.bank.behavior.lostResponseRate = 1;

    await lab.topUp();

    expect(lab.bank.duplicates()).toBe(3);
  });

  it('sau: mọi lần retry cùng một key chỉ tạo một giao dịch', async () => {
    lab = await Lab.start({ mode: 'sau', budget: { ratio: 0.1, capacity: 200 } });
    lab.bank.behavior.lostResponseRate = 0.5;
    lab.bank.behavior.capacityRps = 100_000;

    await Promise.all(Array.from({ length: 100 }, () => lab.topUp()));

    expect(lab.bank.transfers.length).toBeGreaterThanOrEqual(99);
    expect(lab.bank.duplicates()).toBe(0);
  });
});

describe('Hết lượt retry, kết quả chưa biết', () => {
  let lab: Lab;

  afterEach(() => lab.stop());

  it('lệnh hết lượt retry trả "đang xử lý", không báo thất bại', async () => {
    lab = await Lab.start({ mode: 'sau', reconcile: { intervalMs: 10 } });
    lab.bank.behavior.lostResponseRate = 1;
    const reply = await lab.topUp();
    expect(reply.status).toBe(200);

    lab.bank.behavior.errorRate = 1;
    const pending = await lab.topUp();
    expect(pending.status).toBe(202);
    expect(await lab.statusOf(pending.body.topupId)).toBe('PENDING');
  });

  it('phản hồi mất ở mọi lần thử: đối soát tìm thấy giao dịch và hoàn tất', async () => {
    lab = await Lab.start({ mode: 'sau', budget: { ratio: 0.1, capacity: 0 }, reconcile: { intervalMs: 10 } });
    lab.bank.behavior.lostResponseRate = 1;

    const reply = await lab.topUp();

    expect(reply.status).toBe(202);
    await waitUntil(async () => (await lab.statusOf(reply.body.topupId)) === 'COMPLETED', 'đối soát hoàn tất');
    expect(lab.bank.transfers).toHaveLength(1);
  });

  it('lệnh chưa từng tới đối tác: đối soát gửi lại cùng key, hoàn tất với đúng một giao dịch', async () => {
    lab = await Lab.start({ mode: 'sau', budget: { ratio: 0.1, capacity: 0 }, reconcile: { intervalMs: 10 } });
    lab.bank.behavior.errorRate = 1;

    const reply = await lab.topUp();
    expect(reply.status).toBe(202);
    expect(lab.bank.transfers).toHaveLength(0);

    lab.bank.behavior.errorRate = 0;
    await waitUntil(async () => (await lab.statusOf(reply.body.topupId)) === 'COMPLETED', 'đối soát gửi lại');
    expect(lab.bank.transfers).toHaveLength(1);
  });

  it('đối tác vẫn lỗi quá hạn: đánh dấu thất bại để con người xử lý', async () => {
    lab = await Lab.start({
      mode: 'sau',
      budget: { ratio: 0.1, capacity: 0 },
      reconcile: { intervalMs: 10, giveUpAfterMs: 50 },
    });
    lab.bank.behavior.errorRate = 1;

    const reply = await lab.topUp();

    await waitUntil(async () => (await lab.statusOf(reply.body.topupId)) === 'FAILED', 'đối soát bỏ cuộc');
    expect(lab.bank.transfers).toHaveLength(0);
  });
});
