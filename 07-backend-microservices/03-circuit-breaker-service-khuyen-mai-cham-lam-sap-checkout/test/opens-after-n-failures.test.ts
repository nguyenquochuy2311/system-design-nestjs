import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { breakerStates, CheckoutApp, FAST_BREAKER, FakePromotion, logs, tripBreaker } from './support/stack';

describe('Promotion chậm vượt timeout', () => {
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

  it('bình thường: cầu dao đóng, giảm giá được áp dụng', async () => {
    const reply = await app.checkout();

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ totalVnd: 99_000, discountVnd: 1_000, promotionUnavailable: false });
    expect(breakerStates()).toEqual([]);
  });

  it('vượt ngưỡng thì cầu dao mở, lời gọi tiếp theo không chạm promotion', async () => {
    await tripBreaker(app, promotion);
    expect(breakerStates()).toEqual(['open']);
    const reachedPromotion = promotion.requests;

    const replies = await Promise.all(Array.from({ length: 20 }, () => app.checkout()));

    expect(promotion.requests).toBe(reachedPromotion);
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
  });

  it('cầu dao mở thì checkout trả ngay bằng fallback có cờ promotionUnavailable', async () => {
    await tripBreaker(app, promotion);

    const reply = await app.checkout();

    expect(reply.ms).toBeLessThan(FAST_BREAKER.timeoutMs);
    expect(reply.body).toMatchObject({ totalVnd: 100_000, discountVnd: 0, promotionUnavailable: true });
  });

  it('lời gọi quá timeout cũng dùng fallback, trả về sau đúng timeout chứ không chờ promotion', async () => {
    promotion.delayMs = 1_000;

    const reply = await app.checkout();

    expect(reply.status).toBe(200);
    expect(reply.ms).toBeLessThan(500);
    expect(reply.body.promotionUnavailable).toBe(true);
  });

  it('tải thấp: vài lỗi dưới số lời gọi tối thiểu không làm mở cầu dao', async () => {
    promotion.delayMs = 1_000;

    await Promise.all(Array.from({ length: FAST_BREAKER.volumeThreshold - 3 }, () => app.checkout()));

    expect(breakerStates()).toEqual([]);
  });

  it('metric phơi trạng thái, số lần mở và số lần dùng fallback', async () => {
    await tripBreaker(app, promotion);
    await app.checkout();

    const metrics = await app.metrics();

    expect(metrics).toContain('circuit_breaker_state 2');
    expect(metrics).toContain('circuit_breaker_opened_total 1');
    expect(metrics).toMatch(/circuit_breaker_fallback_total (1[3-9]|[2-9]\d)/);
  });
});
