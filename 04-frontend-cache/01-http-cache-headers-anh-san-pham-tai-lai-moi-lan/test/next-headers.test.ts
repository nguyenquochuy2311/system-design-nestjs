import { afterEach, describe, expect, it } from 'vitest';
import { CHROME_ACCEPT_ENCODING, WEB_PORT, rawGet, staticAssetsIn, startWeb, type Proc } from './support/lab';

// Gọi thẳng máy gốc của trang (Next.js production qua web/server.ts), không qua CDN.
const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
// HTML lấy không nén để đọc được đường dẫn file tĩnh; file tĩnh hỏi kèm Accept-Encoding như Chrome.
const html = (path: string, headers: Record<string, string> = {}) => rawGet(`${ORIGIN}${path}`, headers);
const asset = (path: string) => rawGet(`${ORIGIN}${path}`, { 'Accept-Encoding': CHROME_ACCEPT_ENCODING });

describe('trang Next.js', () => {
  let web: Proc | undefined;
  afterEach(async () => {
    await web?.stop();
    web = undefined;
  });

  it('bản sau: file băm tên immutable một năm; HTML no-cache + ETag, If-None-Match khớp thì 304', async () => {
    web = await startWeb('sau');
    const page = await html('/danh-muc/dien-thoai');
    expect(page.header('cache-control')).toBe('no-cache');
    const etag = page.header('etag');
    expect(etag).toMatch(/^"\w+"$/);
    const assets = staticAssetsIn(page.text());
    expect(assets.length).toBeGreaterThan(3);
    for (const a of assets) expect((await asset(a)).header('cache-control'), a).toBe('public, max-age=31536000, immutable');
    const again = await html('/danh-muc/dien-thoai', { 'If-None-Match': etag! });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it('bản trước (tái hiện): HTML và mọi file /_next/static đều no-store, không ETag, không Last-Modified', async () => {
    web = await startWeb('truoc');
    const page = await html('/danh-muc/dien-thoai');
    expect(page.header('cache-control')).toBe('no-store');
    expect(page.header('etag')).toBeUndefined();
    const assets = staticAssetsIn(page.text());
    expect(assets.length).toBeGreaterThan(3);
    for (const a of assets) {
      const res = await asset(a);
      expect(res.header('cache-control'), a).toBe('no-store');
      expect(res.header('etag'), a).toBeUndefined();
      expect(res.header('last-modified'), a).toBeUndefined();
    }
  });
});
