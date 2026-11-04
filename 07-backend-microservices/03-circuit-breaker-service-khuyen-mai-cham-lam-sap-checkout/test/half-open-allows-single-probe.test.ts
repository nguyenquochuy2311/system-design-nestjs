import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { breakerStates, CheckoutApp, FAST_BREAKER, FakePromotion, logs, sleep, tripBreaker } from './support/stack';

describe('Hết thời gian nghỉ', () => {
  let promotion: FakePromotion;
  let app: CheckoutApp;

  beforeEach(async () => {
    logs.length = 0;
    promotion = await FakePromotion.start();
    app = await CheckoutApp.start({ mode: 'sau', promotionUrl: promotion.url, breaker: FAST_BREAKER });
    await tripBreaker(app, promotion);
    await sleep(FAST_BREAKER.resetTimeout + 50);
  });
  afterEach(async () => {
    await app.stop();
    await promotion.stop();
  });

  it('nhiều request cùng lúc nhưng chỉ một lời gọi thử tới được promotion', async () => {
    promotion.delayMs = 50;
    const reachedPromotion = promotion.requests;

    const replies = await Promise.all(Array.from({ length: 30 }, () => app.checkout()));

    expect(promotion.requests - reachedPromotion).toBe(1);
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
  });

  it('lời gọi thử thành công thì cầu dao đóng, lưu lượng trở lại bình thường', async () => {
    promotion.delayMs = 0;

    await app.checkout();
    const reply = await app.checkout();

    expect(breakerStates()).toEqual(['open', 'halfOpen', 'close']);
    expect(reply.body.promotionUnavailable).toBe(false);
  });

  it('lời gọi thử thất bại thì cầu dao mở tiếp', async () => {
    promotion.delayMs = 1_000;

    await app.checkout();

    expect(breakerStates()).toEqual(['open', 'halfOpen', 'open']);
  });
});
