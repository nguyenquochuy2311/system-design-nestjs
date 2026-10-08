// (e) Mạng lỗi lúc làm mới: bản sau giữ dữ liệu cũ, báo thời điểm của bản đang hiện và cho thử lại; bản trước chỉ còn
// vòng xoay rồi thông báo lỗi.
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchChrome, listUrl, newDispatcher, resetApi, tableState, waitListSettled, type Variant } from './support/lab';

let browser: Browser;
const contexts: BrowserContext[] = [];
beforeAll(async () => {
  browser = await launchChrome();
});
afterAll(async () => {
  for (const c of contexts) await c.close();
  await browser?.close();
});
beforeEach(async () => {
  await resetApi();
});

// Cùng một hàm cho route và unroute: Playwright so hàm so khớp theo tham chiếu.
const isOrderList = (url: URL) => url.pathname === '/api/orders';

/** Danh sách → chi tiết; cắt mạng tới /api/orders (lỗi mạng, không phải HTTP 5xx); ở chi tiết dwellMs rồi bấm Back. */
async function backWhileOffline(variant: Variant, uid: string, dwellMs: number): Promise<{ page: Page; generatedAt: number }> {
  const ctx = await newDispatcher(browser, uid);
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(listUrl(variant));
  await waitListSettled(page);
  const generatedAt = (await tableState(page))!.generatedAt;
  await page.locator('[data-testid="order-link"]').nth(1).click();
  await page.waitForSelector('[data-testid="order-detail"]');
  await page.route(isOrderList, (route) => route.abort('internetdisconnected'));
  await sleep(dwellMs);
  await page.goBack();
  return { page, generatedAt };
}

describe('mạng lỗi khi quay lại danh sách', () => {
  it('bản sau: vẫn hiện dữ liệu cũ, báo "không cập nhật được" kèm thời điểm của bản đang hiện, bấm thử lại khi có mạng', async () => {
    const { page, generatedAt } = await backWhileOffline('sau', 'e-sau-d01', 16_000);
    await page.waitForSelector('[data-testid="list-refresh-error"]', { timeout: 10_000 });
    const t = await tableState(page);
    expect(t!.rows).toHaveLength(50);
    expect(t!.generatedAt).toBe(generatedAt);
    const hhmmss = new Date(generatedAt).toLocaleTimeString('vi-VN', { hour12: false });
    expect(await page.textContent('[data-testid="list-refresh-error"]')).toContain(`đang hiện dữ liệu lúc ${hhmmss}`);
    expect(await page.locator('[data-testid="list-loading"]').count()).toBe(0);

    await page.unroute(isOrderList);
    await page.click('[data-testid="list-retry"]');
    await page.waitForFunction((g) => Number(document.querySelector<HTMLElement>('[data-testid="order-table"]')?.dataset.generatedAt) > g, generatedAt);
    await waitListSettled(page);
    expect(await page.locator('[data-testid="list-refresh-error"]').count()).toBe(0);
  });

  it('bản trước: chỉ còn vòng xoay rồi thông báo lỗi, không còn hàng nào', async () => {
    const { page } = await backWhileOffline('truoc', 'e-truoc-d01', 1_000);
    await page.waitForSelector('[data-testid="list-error"]', { timeout: 10_000 });
    expect(await page.locator('[data-testid="order-row"]').count()).toBe(0);
  });
});
