import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { purgeCdn } from '../scripts/cdn';
import { deploy, resetSite, wwwDirOf } from '../scripts/deploy';
import { apiUrl, assertCdnUp, launchChrome, manifestOf, newUser, openTab, runningVersion, startApi, type Proc } from './support/lab';

// Kịch bản lỗi tải chunk: deploy xóa assets của bản trước (keepReleases: 1, như deploy kiểu thay cả thư mục)
// trong khi một tab bản 41 chưa từng mở màn Báo cáo (chunk tải lười).
describe('bắt lỗi tải chunk (vite:preloadError)', () => {
  let browser: Browser;
  let api: Proc | undefined;
  beforeAll(async () => {
    await assertCdnUp();
    browser = await launchChrome();
  });
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(async () => {
    await api?.stop();
    api = undefined;
  });

  async function oldTabThenDeleteDeploy() {
    resetSite('sau');
    await purgeCdn();
    api = await startApi('sau', '41');
    await deploy({ site: 'sau', release: '41', api: apiUrl('sau') });
    const ctx = await newUser(browser, 'sau', 'test-chunk');
    // Ghi lại sự kiện của Vite ở mọi trang mở trong context (init script chạy trước bundle).
    await ctx.addInitScript(() => {
      window.addEventListener('vite:preloadError', (e) => console.log(`vite:preloadError ${String((e as Event & { payload?: Error }).payload?.message)}`));
    });
    const tab = await openTab(ctx, 'sau', '/');
    const events: string[] = [];
    tab.page.on('console', (m) => {
      if (m.text().startsWith('vite:preloadError')) events.push(m.text());
    });
    await tab.page.waitForSelector('[data-screen=contacts]');
    const r42 = await deploy({ site: 'sau', release: '42', keepReleases: 1, api: apiUrl('sau') });
    return { ctx, tab, events, r42 };
  }

  it('Vite 8 phát vite:preloadError khi chunk 404; bản sau tải lại đúng một lần ở đích và hiện màn bản 42', async () => {
    const { ctx, tab, events } = await oldTabThenDeleteDeploy();
    await tab.page.click('a[data-nav=reports]');
    await tab.page.waitForSelector('[data-screen=reports]');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/Failed to fetch dynamically imported module: .*\/assets\/reports-.*\.js/);
    expect(tab.failed.map((f) => f.status)).toEqual([404]);
    expect(tab.loads).toBe(2);
    expect(tab.page.url()).toMatch(/\/bao-cao$/);
    expect(await runningVersion(tab.page)).toBe('42');
    expect(tab.pageErrors).toEqual([]);
    await ctx.close();
  });

  it('lỗi lặp lại ngay sau lần tải lại thì không tải lại nữa (không vòng lặp), lỗi hiện ra', async () => {
    const { ctx, tab, events, r42 } = await oldTabThenDeleteDeploy();
    // Bản 42 cũng hỏng: chunk báo cáo của nó biến mất (deploy dở, xóa nhầm).
    const reports42 = Object.values(manifestOf(r42.buildDir)).find((m) => m.isDynamicEntry)!.file;
    rmSync(join(wwwDirOf('sau'), reports42));
    await tab.page.click('a[data-nav=reports]');
    await tab.page.waitForFunction(() => document.getElementById('root')?.childElementCount === 0, undefined, { timeout: 15_000 });
    await tab.page.waitForTimeout(1_500);
    expect(events).toHaveLength(2);
    expect(tab.loads).toBe(2);
    expect(tab.pageErrors.some((m) => /Failed to fetch dynamically imported module/.test(m))).toBe(true);
    await ctx.close();
  });
});
