import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CDN, rawGet, sessionCookie, startApi, unique, waitHttp, type Proc } from './support/lab';

// Qua CDN mô phỏng thật (Nginx 58088 -> API 3100). Nginx không đưa cookie vào khóa cache, giống cấu hình mặc định của
// đa số CDN, nên chỉ header của máy gốc quyết định giỏ hàng có bị lưu chung hay không.
// Query ?t=<duy nhất> để mỗi lượt test có khóa cache riêng, không dính bản lưu từ lượt trước.
async function summaryVia(path: string, userId: number) {
  const res = await rawGet(`${CDN}${path}`, { Cookie: sessionCookie(userId) });
  return { status: res.status, cache: res.header('x-cache-status'), cacheControl: res.header('cache-control'), body: JSON.parse(res.text()) as { userId: number } };
}

describe('CDN mô phỏng và giỏ hàng', () => {
  let api: Proc | undefined;
  beforeAll(async () => {
    await waitHttp(`${CDN}/__cdn/health`, 5_000).catch(() => {
      throw new Error('CDN mô phỏng chưa chạy: docker compose up -d --wait');
    });
  });
  afterEach(async () => {
    await api?.stop();
    api = undefined;
  });

  it('bản sau: khách B luôn nhận giỏ của chính B, CDN không lưu (MISS cả hai lượt)', async () => {
    api = await startApi('sau');
    const path = `/api/cart/summary?t=${unique()}`;
    const a = await summaryVia(path, 1001);
    const b = await summaryVia(path, 1002);
    expect(a.body.userId).toBe(1001);
    expect(b.body.userId).toBe(1002);
    expect([a.cache, b.cache]).toEqual(['MISS', 'MISS']);
    expect(b.cacheControl).toBe('private, no-store');
  });

  it('bản trước (tái hiện): khách B nhận giỏ hàng của khách A từ CDN (HIT)', async () => {
    api = await startApi('truoc');
    const path = `/api/cart/summary?t=${unique()}`;
    const a = await summaryVia(path, 1001);
    const b = await summaryVia(path, 1002);
    expect(a.body.userId).toBe(1001);
    expect(b.cache).toBe('HIT');
    expect(b.body.userId).toBe(1001);
  });
});
