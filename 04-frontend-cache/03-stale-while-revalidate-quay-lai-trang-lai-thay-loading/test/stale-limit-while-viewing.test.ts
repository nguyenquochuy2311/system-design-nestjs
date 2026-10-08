// Ràng buộc nghiệp vụ "trạng thái đơn không cũ quá 30 giây khi đang nhìn": bản sau làm mới định kỳ theo tuổi dữ liệu
// (tối đa 28 giây, xem order-queries.ts) trong lúc danh sách đang hiện; bản trước không bao giờ tự làm mới.
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { changeOrder, launchChrome, listUrl, newDispatcher, resetApi, tableState, waitListSettled, type Variant } from './support/lab';

const STALE_LIMIT_MS = 30_000; // ràng buộc nghiệp vụ, không phải cấu hình
const MAX_AGE_MS = 28_000;
const LIST_LATENCY_MS = 1_200;

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

/** Đọc màn hình mỗi 100 ms tới khi đơn `id` không còn trong danh sách "Mới"; trả số ms kể từ lúc đổi (hoặc null). */
async function msUntilGone(page: Page, id: string, since: number): Promise<number | null> {
  const deadline = since + STALE_LIMIT_MS + LIST_LATENCY_MS + 12_000;
  while (Date.now() < deadline) {
    if (!((await tableState(page))?.rows.some((r) => r.id === id) ?? true)) return Date.now() - since;
    await sleep(100);
  }
  return null;
}

const stillShown = async (page: Page, id: string) => (await tableState(page))?.rows.some((r) => r.id === id) ?? true;

describe('đang nhìn danh sách khi người khác nhận đơn', () => {
  it('bản sau thấy thay đổi trong vòng 30 giây kể cả khi thay đổi vừa lỡ một bản chụp; bản trước vẫn hiện bản cũ', async () => {
    // Cùng khu vực (uid kết thúc bằng 01): hai màn hình nhìn cùng danh sách.
    const [sau, truoc] = await Promise.all([openList('sau', 'f-sau-d01'), openList('truoc', 'f-truoc-d01')]);
    const id = (await tableState(sau))!.rows[0]!.id;
    expect((await tableState(truoc))!.rows[0]!.id).toBe(id);
    // Ngay sau lần tải đầu: trường hợp xấu nhất, thay đổi vừa lỡ một bản chụp.
    const c = await changeOrder(id, { status: 'da-nhan', assignee: 'Shipper 33' });
    const staleMs = await msUntilGone(sau, id, c.t);
    expect(staleMs).not.toBeNull();
    expect(staleMs!).toBeLessThanOrEqual(STALE_LIMIT_MS);
    expect(staleMs!).toBeGreaterThan(MAX_AGE_MS - 2_000);
    // Bản trước: cùng lúc đó vẫn hiện đơn như "Mới".
    expect(await stillShown(truoc, id)).toBe(true);
  });

  it('bản sau: quay lại trong staleTime (không tải lại) rồi ở lại danh sách, vẫn thấy thay đổi trong vòng 30 giây', async () => {
    const page = await openList('sau', 'f-sau-d02');
    const id = (await tableState(page))!.rows[0]!.id;
    const c = await changeOrder(id, { status: 'da-nhan', assignee: 'Shipper 33' });
    await page.locator('[data-testid="order-link"]').nth(5).click();
    await page.waitForSelector('[data-testid="order-detail"]');
    await sleep(8_000);
    await page.goBack();
    await page.waitForSelector('[data-testid="order-row"]');
    // Còn trong staleTime: hiện bản cũ, không tải lại ngay.
    expect(await stillShown(page, id)).toBe(true);
    expect(await page.locator('[data-testid="list-refreshing"]').count()).toBe(0);
    const staleMs = await msUntilGone(page, id, c.t);
    expect(staleMs).not.toBeNull();
    expect(staleMs!).toBeLessThanOrEqual(STALE_LIMIT_MS);
  });
});
