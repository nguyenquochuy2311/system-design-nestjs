import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { purgeCdn } from '../scripts/cdn';
import { deploy, resetSite } from '../scripts/deploy';
import { apiUrl, assertCdnUp, launchChrome, newUser, openTab, runningVersion, startApi, type Proc } from './support/lab';

describe('báo có bản mới (version.json)', () => {
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

  it('version.json đổi thì hiện banner và KHÔNG tự tải lại: chữ đang gõ còn nguyên; bấm "Tải lại" mới sang bản 42', async () => {
    resetSite('sau');
    await purgeCdn();
    api = await startApi('sau', '41');
    await deploy({ site: 'sau', release: '41', api: apiUrl('sau') });
    const ctx = await newUser(browser, 'sau', 'test-banner');
    const tab = await openTab(ctx, 'sau', '/khach-hang/9');
    const { page } = tab;
    await page.waitForSelector('[data-screen=contact-detail]');
    await page.fill('[data-note-input]', 'Đang gõ dở, chưa lưu');
    await page.evaluate(() => {
      (window as Window & { __marker?: number }).__marker = 1;
    });
    await deploy({ site: 'sau', release: '42', api: apiUrl('sau') });
    // Người dùng quay lại tab (visibilitychange): bản sau hỏi version.json.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('#update-banner[data-version="42"]');
    await page.waitForTimeout(1_000);
    expect(await page.inputValue('[data-note-input]')).toBe('Đang gõ dở, chưa lưu');
    expect(await page.evaluate(() => (window as Window & { __marker?: number }).__marker)).toBe(1);
    expect(tab.loads).toBe(1);
    expect(await runningVersion(page)).toBe('41');
    await page.click('#update-banner button');
    await page.waitForSelector('[data-screen=contact-detail]');
    await page.waitForFunction(() => window.__APP__?.version === '42');
    expect(tab.loads).toBe(2);
    await ctx.close();
  });
});
