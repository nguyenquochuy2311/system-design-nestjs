import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CDN, CHROME_ACCEPT_ENCODING, CHROME_IMG_ACCEPT, rawGet, staticAssetsIn, startApi, startWeb, unique, waitHttp, type Proc } from './support/lab';

const get = (path: string, headers: Record<string, string> = {}) => rawGet(`${CDN}${path}`, { 'Accept-Encoding': CHROME_ACCEPT_ENCODING, ...headers });

describe('bản sau qua CDN mô phỏng: Vary, HIT và 304', () => {
  let api: Proc;
  let web: Proc;
  beforeAll(async () => {
    await waitHttp(`${CDN}/__cdn/health`, 5_000).catch(() => {
      throw new Error('CDN mô phỏng chưa chạy: docker compose up -d --wait');
    });
    api = await startApi('sau');
    web = await startWeb('sau');
  });
  afterAll(async () => {
    await api?.stop();
    await web?.stop();
  });

  it('Vary: Accept — trình duyệt không nhận WebP không bao giờ nhận bản WebP mà CDN đã lưu', async () => {
    const path = `/media/12/thumb?v=1&t=${unique()}`;
    const webp = await get(path, { Accept: CHROME_IMG_ACCEPT });
    const jpeg = await get(path, { Accept: 'image/jpeg,image/*;q=0.8' });
    const webpAgain = await get(path, { Accept: CHROME_IMG_ACCEPT });
    expect([webp.header('content-type'), webp.header('x-cache-status')]).toEqual(['image/webp', 'MISS']);
    expect([jpeg.header('content-type'), jpeg.header('x-cache-status')]).toEqual(['image/jpeg', 'MISS']);
    expect([webpAgain.header('content-type'), webpAgain.header('x-cache-status')]).toEqual(['image/webp', 'HIT']);
  });

  it('JSON công khai: lượt hai HIT, If-None-Match khớp thì CDN tự trả 304 không gọi máy gốc', async () => {
    const path = `/api/products/12?t=${unique()}`;
    const first = await get(path);
    const second = await get(path);
    const conditional = await get(path, { 'If-None-Match': first.header('etag')! });
    expect(first.header('x-cache-status')).toBe('MISS');
    expect(second.header('x-cache-status')).toBe('HIT');
    expect(conditional.status).toBe(304);
    expect(conditional.header('x-cache-status')).toBe('HIT');
    expect(conditional.body.length).toBe(0);
  });

  it('file /_next/static: lượt hai HIT ở CDN', async () => {
    const html = (await rawGet(`${CDN}/danh-muc/laptop?t=${unique()}`)).text();
    const assets = staticAssetsIn(html);
    expect(assets.length).toBeGreaterThan(3);
    for (const a of assets) {
      const path = `${a}?t=${unique()}`;
      expect((await get(path)).header('x-cache-status'), a).toBe('MISS');
      const again = await get(path);
      expect(again.header('x-cache-status'), a).toBe('HIT');
      expect(again.header('cache-control'), a).toBe('public, max-age=31536000, immutable');
    }
  });

  it('HTML no-cache: CDN không lưu và KHÔNG chuyển If-None-Match về máy gốc, nên qua CDN này HTML luôn 200 đủ body', async () => {
    // Hành vi của Nginx proxy_cache (đã kiểm ở mục 3.4): với response không lưu được, Nginx bỏ If-None-Match của client.
    const path = `/danh-muc/laptop?t=${unique()}`;
    const first = await get(path);
    const conditional = await get(path, { 'If-None-Match': first.header('etag')! });
    expect(first.header('cache-control')).toBe('no-cache');
    expect(conditional.status).toBe(200);
    expect(conditional.header('x-cache-status')).toBe('MISS');
    expect(conditional.body.length).toBeGreaterThan(1_000);
  });
});
