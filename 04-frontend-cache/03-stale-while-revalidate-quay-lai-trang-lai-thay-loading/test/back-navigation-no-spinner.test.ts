// (a) Quay lại danh sách khi cache đã có dữ liệu: bản trước dựng lại component và quay vòng chờ API; bản sau hiện
// ngay bản đang có, và chỉ làm mới ở nền khi đã quá staleTime.
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchChrome, listUrl, newDispatcher, peekEvents, requestsSince, resetApi, tableState, waitListSettled, type Variant } from './support/lab';
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

/** Mở danh sách, cuộn xuống hàng 30, mở chi tiết, ở đó dwellMs. Trả scrollY lúc rời danh sách. */
async function leaveListFor(variant: Variant, uid: string, dwellMs: number): Promise<{ page: Page; scrollY: number; generatedAt: number }> {
  const ctx = await newDispatcher(browser, uid);
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(listUrl(variant));
  await waitListSettled(page);
  const generatedAt = (await tableState(page))!.generatedAt;
  const link = page.locator('[data-testid="order-link"]').nth(30);
  await link.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  await link.click();
  await page.waitForSelector('[data-testid="order-detail"]');
  await sleep(dwellMs);
  return { page, scrollY, generatedAt };
}

const listShows = async (page: Page) => (await peekEvents(page)).filter((e) => e.type === 'list-show').map((e) => e.instance as string);
const orderRequestsSince = async (t: number, uid: string) => (await requestsSince(t, uid)).filter((l) => l.path === '/api/orders');

describe('quay lại danh sách đơn', () => {
  it('bản trước: component bị dựng lại, hiện vòng xoay, gọi lại API, mất vị trí cuộn', async () => {
    const uid = 'a-truoc-d01';
    const { page, scrollY } = await leaveListFor('truoc', uid, 1_000);
    const before = await listShows(page);
    await startNavProbe(page);
    const r = await waitNavDone(page);
    expect(r.rowsWereOnScreenBefore).toBe(false);
    expect(r.spinnerMs).not.toBeNull();
    // Phải chờ API danh sách (độ trễ giả lập 1,2 s).
    expect(r.rowsFrameMs!).toBeGreaterThan(1_000);
    // Dữ liệu đầu tiên hiện ra là dữ liệu mới tải: không có gì được giữ giữa hai màn hình.
    expect(r.firstGeneratedAt!).toBeGreaterThanOrEqual(r.wall0);
    const after = await listShows(page);
    expect(after.length).toBe(before.length + 1);
    expect(before).not.toContain(after.at(-1));
    expect(await orderRequestsSince(r.wall0, uid)).toHaveLength(1);
    expect(scrollY).toBeGreaterThan(300);
    expect(r.scrollYAtRows).toBe(0);
  });

  it('bản sau: quay lại trong staleTime hiện ngay dữ liệu đang có, không vòng xoay, không gọi lại API, giữ vị trí cuộn', async () => {
    const uid = 'a-sau-d01';
    const { page, scrollY, generatedAt } = await leaveListFor('sau', uid, 2_000);
    await startNavProbe(page);
    const r = await waitNavDone(page, { fresh: false });
    expect(r.spinnerMs).toBeNull();
    expect(r.rowsFrameMs!).toBeLessThan(500);
    expect(r.firstGeneratedAt).toBe(generatedAt);
    expect(r.refreshingSeen).toBe(false);
    await sleep(1_500);
    expect(await orderRequestsSince(r.wall0, uid)).toHaveLength(0);
    expect(r.scrollYAtRows).toBe(scrollY);
  });

  it('bản sau: quay lại khi đã quá staleTime vẫn hiện ngay bản cũ, báo "đang cập nhật", làm mới ở nền rồi thay tại chỗ', async () => {
    const uid = 'a-sau-d02';
    const { page, generatedAt } = await leaveListFor('sau', uid, 16_000);
    await startNavProbe(page);
    const r = await waitNavDone(page);
    expect(r.spinnerMs).toBeNull();
    expect(r.rowsFrameMs!).toBeLessThan(500);
    expect(r.firstGeneratedAt).toBe(generatedAt);
    expect(r.wall0 - generatedAt).toBeGreaterThan(15_000);
    expect(r.refreshingSeen).toBe(true);
    // Bản mới về sau độ trễ của API, không sớm hơn.
    expect(r.freshMs!).toBeGreaterThan(1_000);
    expect(r.freshMs!).toBeLessThan(5_000);
    expect(await orderRequestsSince(r.wall0, uid)).toHaveLength(1);
  });
});
