// (c) Phân đơn xong, danh sách được làm mới: bản sau invalidate mọi danh sách đơn nên lần quay lại (dù còn trong
// staleTime) vẫn làm mới ở nền; server vẫn là nơi quyết định khi client đang xem bản cũ (409).
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { changeOrder, launchChrome, listUrl, newDispatcher, requestsSince, resetApi, tableState, waitListSettled, type Variant } from './support/lab';
import { startNavProbe, waitNavDone } from './support/nav-probe';

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

async function openList(variant: Variant, uid: string): Promise<Page> {
  const ctx = await newDispatcher(browser, uid);
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(listUrl(variant));
  await waitListSettled(page);
  return page;
}

/** Mở đơn thứ n của danh sách "Mới", phân cho shipper, chờ màn chi tiết báo đã nhận, rồi bấm Back. */
async function assignThenBack(page: Page, n: number): Promise<string> {
  const id = (await tableState(page))!.rows[n]!.id;
  await page.locator(`[data-testid="order-row"][data-id="${id}"] [data-testid="order-link"]`).click();
  await page.waitForSelector('[data-testid="assign"]');
  await page.click('[data-testid="assign"]');
  await page.waitForSelector('[data-testid="order-detail"][data-status="da-nhan"]');
  await startNavProbe(page);
  return id;
}

const rowIds = async (page: Page) => (await tableState(page))?.rows.map((r) => r.id) ?? [];

describe('phân đơn rồi quay lại danh sách', () => {
  it('bản sau: dù còn trong staleTime, danh sách làm mới ở nền và đơn vừa phân rời khỏi bộ lọc "Mới"', async () => {
    const uid = 'c-sau-d01';
    const page = await openList('sau', uid);
    const id = await assignThenBack(page, 2);
    const r = await waitNavDone(page);
    // Lần quay lại diễn ra vài giây sau lần tải danh sách (còn trong staleTime 15 s): chỉ invalidate mới làm nó tải lại.
    expect(r.wall0 - r.firstGeneratedAt!).toBeLessThan(15_000);
    expect(r.spinnerMs).toBeNull();
    expect(r.refreshingSeen).toBe(true);
    expect(await rowIds(page)).not.toContain(id);
    expect((await requestsSince(r.wall0, uid)).filter((l) => l.path === '/api/orders')).toHaveLength(1);
  });

  it('bản trước: danh sách tải lại từ đầu (vòng xoay) rồi mới đúng', async () => {
    const page = await openList('truoc', 'c-truoc-d01');
    const id = await assignThenBack(page, 2);
    const r = await waitNavDone(page);
    expect(r.spinnerMs).not.toBeNull();
    expect(r.rowsFrameMs!).toBeGreaterThan(1_000);
    expect(await rowIds(page)).not.toContain(id);
  });

  it('bản sau: phân một đơn người khác vừa nhận (ta còn xem bản cũ) thì API trả 409 và màn chi tiết hiện người đã nhận', async () => {
    const page = await openList('sau', 'c-sau-d02');
    const id = (await tableState(page))!.rows[4]!.id;
    await page.locator(`[data-testid="order-row"][data-id="${id}"] [data-testid="order-link"]`).click();
    await page.waitForSelector('[data-testid="assign"]');
    await changeOrder(id, { status: 'da-nhan', assignee: 'Shipper 33' });
    await page.click('[data-testid="assign"]');
    await page.waitForSelector('[data-testid="detail-message"]');
    expect(await page.textContent('[data-testid="detail-message"]')).toContain('đã có người nhận');
    await page.waitForFunction(() => document.querySelector('[data-testid="detail-assignee"]')?.textContent === 'Shipper 33');
  });
});
