// (d) Máy dùng chung: đăng xuất xóa sạch cache dữ liệu; người đăng nhập sau (khu vực khác) không thấy dù một khoảnh
// khắc dữ liệu khách hàng của người trước.
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchChrome, newContext, resetApi, truth, waitListSettled, WEB } from './support/lab';
import { startNavProbe, stopNavProbe } from './support/nav-probe';

let browser: Browser;
let ctx: BrowserContext;
beforeAll(async () => {
  browser = await launchChrome();
});
afterAll(async () => {
  await ctx?.close();
  await browser?.close();
});
beforeEach(async () => {
  await resetApi();
});

async function loginAs(page: Page, uid: string): Promise<void> {
  await page.selectOption('[data-testid="login-uid"]', uid);
  await page.click('[data-testid="login-submit"]');
}

const queryCount = (page: Page) => page.evaluate(() => window.__LAB__?.queryCount?.() ?? -1);

describe('đăng xuất trên máy dùng chung (bản sau)', () => {
  it('đăng xuất xóa mọi truy vấn khỏi cache; người sau chỉ thấy vòng xoay rồi dữ liệu của chính mình', async () => {
    ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${WEB}/sau/login`);
    await loginAs(page, 'd01'); // khu vực Quận 1
    await waitListSettled(page);
    const d01Ids = (await truth('d01', { status: 'moi', warehouse: 'tat-ca', page: 1 })).items.map((o) => o.id);
    await page.locator('[data-testid="order-link"]').nth(3).click();
    await page.waitForSelector('[data-testid="order-detail"]');
    await page.goBack();
    await waitListSettled(page);
    expect(await queryCount(page)).toBeGreaterThan(2);

    await page.click('[data-testid="logout"]');
    await page.waitForURL('**/sau/login');
    expect(await queryCount(page)).toBe(0);
    // Không có bản lưu nào khác của dữ liệu trong trình duyệt (cache chỉ nằm trong bộ nhớ, không persister).
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

    await startNavProbe(page, 'none');
    await loginAs(page, 'd02'); // khu vực Quận 7
    await waitListSettled(page);
    const r = await stopNavProbe(page);
    const d02Ids = (await truth('d02', { status: 'moi', warehouse: 'tat-ca', page: 1 })).items.map((o) => o.id);
    const seen = [...new Set(r.timeline.flatMap((e) => e.ids))];
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((id) => d01Ids.includes(id))).toEqual([]);
    expect(seen.every((id) => d02Ids.includes(id))).toBe(true);
    expect(r.spinnerMs).not.toBeNull();
  });
});
