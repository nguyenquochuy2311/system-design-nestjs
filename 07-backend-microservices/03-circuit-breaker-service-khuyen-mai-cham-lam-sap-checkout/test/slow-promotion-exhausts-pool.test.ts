import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckoutApp, FAST_BREAKER, FakePromotion, logs } from './support/stack';

const POOL_SIZE = 2;
const REQUESTS = 8;

describe('Promotion chậm khi pool kết nối có hạn', () => {
  let promotion: FakePromotion;
  let app: CheckoutApp;

  beforeEach(async () => {
    logs.length = 0;
    promotion = await FakePromotion.start();
    promotion.delayMs = 300;
  });
  afterEach(async () => {
    await app.stop();
    await promotion.stop();
  });

  it('trước: request xếp hàng chờ kết nối, thời gian chờ cộng dồn theo từng lượt', async () => {
    app = await CheckoutApp.start({ mode: 'truoc', promotionUrl: promotion.url, poolSize: POOL_SIZE, truocTimeoutMs: 10_000 });

    const replies = await Promise.all(Array.from({ length: REQUESTS }, () => app.checkout()));

    const slowest = Math.max(...replies.map((reply) => reply.ms));
    expect(slowest).toBeGreaterThan(300 * (REQUESTS / POOL_SIZE) * 0.9);
  });

  it('trước: promotion quá timeout thì checkout thất bại, không có dự phòng', async () => {
    app = await CheckoutApp.start({ mode: 'truoc', promotionUrl: promotion.url, truocTimeoutMs: 100 });

    const reply = await app.checkout();

    expect(reply.status).toBe(503);
  });

  it('sau: timeout hủy hẳn lời gọi nên pool không cạn, mọi request xong trong khoảng timeout', async () => {
    app = await CheckoutApp.start({
      mode: 'sau',
      promotionUrl: promotion.url,
      poolSize: POOL_SIZE,
      breaker: FAST_BREAKER,
    });

    const replies = await Promise.all(Array.from({ length: REQUESTS }, () => app.checkout()));

    expect(replies.every((reply) => reply.status === 200)).toBe(true);
    expect(Math.max(...replies.map((reply) => reply.ms))).toBeLessThan(250);
  });
});
