import { beforeAll, describe, expect, it } from 'vitest';
import { listFiles } from '../scripts/build-release';
import { purgeCdn } from '../scripts/cdn';
import { deploy, resetSite } from '../scripts/deploy';
import { CHROME_ACCEPT_ENCODING, assertCdnUp, rawGet, staticRefs } from './support/lab';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const get = (site: 'sau' | 'truoc', path: string) => rawGet(site, path, { 'Accept-Encoding': CHROME_ACCEPT_ENCODING });

describe('header theo nhóm file, đọc qua CDN mô phỏng', () => {
  let sauBuild: string;
  beforeAll(async () => {
    await assertCdnUp();
    resetSite('sau');
    resetSite('truoc');
    await purgeCdn();
    sauBuild = (await deploy({ site: 'sau', release: '41', api: null })).buildDir;
    await deploy({ site: 'truoc', release: '41', api: null });
  });

  it('bản sau: index.html và mọi route của SPA là no-cache có ETag, CDN không giữ', async () => {
    for (const path of ['/', '/index.html', '/bao-cao', '/khach-hang/7']) {
      const first = await get('sau', path);
      expect(first.status, path).toBe(200);
      expect(first.header('cache-control'), path).toBe('no-cache');
      expect(first.header('etag'), path).toBeTruthy();
      expect((await get('sau', path)).header('x-cache-status'), path).not.toBe('HIT');
    }
  });

  it('bản sau: mọi file trong /assets/ là public, max-age=31536000, immutable và lần hai là HIT ở CDN', async () => {
    const assets = listFiles(sauBuild).filter((f) => f.startsWith('assets/'));
    expect(assets.length).toBeGreaterThanOrEqual(5);
    const html = (await get('sau', '/')).text();
    for (const ref of staticRefs(html)) expect(assets, ref).toContain(ref.slice(1));
    for (const f of assets) {
      const res = await get('sau', `/${f}`);
      expect(res.status, f).toBe(200);
      expect(res.header('cache-control'), f).toBe(IMMUTABLE);
      expect((await get('sau', `/${f}`)).header('x-cache-status'), f).toBe('HIT');
    }
  });

  it('bản sau: version.json và loader widget.js no-cache; loader trỏ tới widget có hash của bản đang chạy', async () => {
    await deploy({ site: 'sau', release: '42', api: null });
    const version = await get('sau', '/version.json');
    expect(version.header('cache-control')).toBe('no-cache');
    expect(JSON.parse(version.text())).toEqual({ version: '42' });
    const loader = await get('sau', '/widget.js');
    expect(loader.header('cache-control')).toBe('no-cache');
    const target = /src='(\/assets\/widget-[^']+\.js)'/.exec(loader.text())?.[1];
    expect(target).toBeTruthy();
    const widget = await get('sau', target!);
    expect(widget.header('cache-control')).toBe(IMMUTABLE);
    expect(widget.text()).toContain('(bản 42)');
  });

  it('bản sau: asset không tồn tại trả 404 thật (không rơi về index.html) và CDN không giữ 404', async () => {
    const path = '/assets/reports-khongco01.js';
    const first = await get('sau', path);
    expect(first.status).toBe(404);
    expect(first.text()).not.toContain('<div id="root">');
    expect((await get('sau', path)).header('x-cache-status')).toBe('MISS');
  });

  it('bản trước (tái hiện): mọi file, kể cả index.html, max-age=86400; CDN giữ index.html', async () => {
    for (const path of ['/', '/app.js', '/vendor.js', '/reports.js', '/app.css', '/widget.js']) {
      const res = await get('truoc', path);
      expect(res.status, path).toBe(200);
      expect(res.header('cache-control'), path).toBe('max-age=86400');
    }
    expect((await get('truoc', '/')).header('x-cache-status')).toBe('HIT');
  });
});
