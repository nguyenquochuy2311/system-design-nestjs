import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { breakerStates, CheckoutApp, FAST_BREAKER, FakePromotion, logs } from './support/stack';

describe('Request sai không phải là promotion hỏng', () => {
  let promotion: FakePromotion;
  let app: CheckoutApp;

  beforeEach(async () => {
    logs.length = 0;
    promotion = await FakePromotion.start();
    app = await CheckoutApp.start({ mode: 'sau', promotionUrl: promotion.url, breaker: FAST_BREAKER });
  });
  afterEach(async () => {
    await app.stop();
    await promotion.stop();
  });

  it('mã khuyến mãi sai trả 422 cho khách, không dùng fallback', async () => {
    promotion.status = 400;

    const reply = await app.checkout('SAI');

    expect(reply.status).toBe(422);
    expect(await app.metrics()).toContain('circuit_breaker_fallback_total 0');
  });

  it('một client gửi sai liên tục không làm mở cầu dao cho mọi người', async () => {
    promotion.status = 400;

    await Promise.all(Array.from({ length: 50 }, () => app.checkout('SAI')));

    expect(breakerStates()).toEqual([]);
    promotion.status = 200;
    expect((await app.checkout()).body.promotionUnavailable).toBe(false);
  });

  it('promotion trả 500 thì có tính là lỗi', async () => {
    promotion.status = 500;

    await Promise.all(Array.from({ length: FAST_BREAKER.volumeThreshold + 2 }, () => app.checkout()));

    expect(breakerStates()).toEqual(['open']);
  });
});
