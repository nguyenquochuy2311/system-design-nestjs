import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { purgeCdn } from '../scripts/cdn';
import { deploy, resetSite } from '../scripts/deploy';
import type { Site } from '../web/releases';
import { apiUrl, assertCdnUp, launchChrome, newUser, openTab, runningVersion, startApi, type Proc } from './support/lab';

interface StoredNote {
  body: string;
  lost: boolean;
  clientVersion: string;
}
const notesOf = async (site: Site, contactId: number) => (await (await fetch(`${apiUrl(site)}/ops/notes?contactId=${contactId}`)).json()) as StoredNote[];

describe('tab mở từ trước khi deploy bản 42 (đổi API danh bạ)', () => {
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

  async function prepare(site: Site) {
    resetSite(site);
    await purgeCdn();
    api = await startApi(site, '41');
    await deploy({ site, release: '41', api: apiUrl(site) });
    const ctx = await newUser(browser, site, `test-${site}`);
    const tab = await openTab(ctx, site, '/khach-hang/5');
    await tab.page.waitForSelector('[data-screen=contact-detail]');
    expect(await runningVersion(tab.page)).toBe('41');
    await deploy({ site, release: '42', api: apiUrl(site) });
    return { ctx, tab };
  }

  it('bản sau: tab cũ lưu ghi chú không mất, mở màn tải lười không lỗi, lần điều hướng sau chuyển sang bản 42', async () => {
    const { ctx, tab } = await prepare('sau');
    const { page } = tab;
    await page.fill('[data-note-input]', 'Khách hẹn ký hợp đồng tuần sau');
    await page.click('[data-note-save]');
    await page.waitForSelector('[data-note-status=saved]');
    expect((await notesOf('sau', 5)).at(-1)).toMatchObject({ body: 'Khách hẹn ký hợp đồng tuần sau', lost: false, clientVersion: '41' });
    // Lần điều hướng đầu sau deploy: vẫn là SPA bản 41, chunk báo cáo của bản 41 còn trên máy gốc.
    await page.click('a[data-nav=reports]');
    await page.waitForSelector('[data-screen=reports]');
    expect(await runningVersion(page)).toBe('41');
    await page.waitForSelector('#update-banner[data-version="42"]');
    // Đã biết có bản mới: lần điều hướng kế tiếp tải trang đầy đủ ở đích, chạy bản 42.
    await page.click('a[data-nav=contacts]');
    await page.waitForSelector('[data-screen=contacts]');
    expect(await runningVersion(page)).toBe('42');
    expect(tab.loads).toBe(2);
    expect(tab.failed).toEqual([]);
    expect(tab.pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.__LAB__?.errors ?? [])).toEqual([]);
    // Tab mới mở lại đúng URL đã có trong cache: index.html no-cache được hỏi lại nên chạy bản 42 ngay.
    const again = await openTab(ctx, 'sau', '/khach-hang/5');
    await again.page.waitForSelector('[data-screen=contact-detail]');
    expect(await runningVersion(again.page)).toBe('42');
    await ctx.close();
  });

  it('bản trước (tái hiện): tab cũ lưu ghi chú bị mất, màn hình trắng vì JS 41 đọc API 42; tab mới vẫn chạy JS 41', async () => {
    const { ctx, tab } = await prepare('truoc');
    const { page } = tab;
    await page.fill('[data-note-input]', 'Khách hẹn ký hợp đồng tuần sau');
    await page.click('[data-note-save]');
    // Lưu xong, màn hình tải lại khách hàng theo hợp đồng mới → initials(undefined) → TypeError, React gỡ cả cây.
    await page.waitForFunction(() => document.getElementById('root')?.childElementCount === 0);
    expect((await notesOf('truoc', 5)).at(-1)).toMatchObject({ body: '', lost: true, clientVersion: '41' });
    expect(tab.pageErrors.some((m) => /Cannot read properties of undefined/.test(m))).toBe(true);
    // Tab mới (cùng trình duyệt): index.html và app.js còn hạn 1 ngày trong cache → vẫn bản 41.
    const fresh = await openTab(ctx, 'truoc', '/');
    await fresh.page.waitForFunction(() => window.__APP__ !== undefined);
    expect(await runningVersion(fresh.page)).toBe('41');
    await fresh.page.waitForFunction(() => document.getElementById('root')?.childElementCount === 0);
    await ctx.close();
  });
});
