// (b) Đổi bộ lọc không bao giờ hiện kết quả của bộ lọc khác (ràng buộc nghiệp vụ), kể cả khi bộ lọc kia đang có
// sẵn trong cache; đổi trang trong cùng bộ lọc thì được giữ trang cũ (mờ) làm chỗ giữ.
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchChrome, listUrl, newDispatcher, resetApi, tableState, waitListSettled } from './support/lab';
import { startNavProbe, stopNavProbe, type TimelineEntry } from './support/nav-probe';

let browser: Browser;
let ctx: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await launchChrome();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  await resetApi();
  await ctx?.close();
  ctx = await newDispatcher(browser, 'b-sau-d01');
  page = await ctx.newPage();
  await page.goto(listUrl('sau'));
  await waitListSettled(page);
});

const param = (search: string, name: string) => new URLSearchParams(search).get(name);

/** Mọi khoảnh khắc mà URL đang chọn một bộ lọc nhưng bảng hiện dữ liệu (hàng) không thuộc bộ lọc đó. */
function violations(timeline: TimelineEntry[]): TimelineEntry[] {
  return timeline.filter((e) => {
    if (e.ids.length === 0) return false;
    const status = param(e.search, 'status') ?? 'moi';
    const warehouse = param(e.search, 'warehouse') ?? 'tat-ca';
    const badStatus = status !== 'tat-ca' && e.statuses.some((s) => s !== status);
    const badWarehouse = warehouse !== 'tat-ca' && e.warehouses.some((w) => w !== warehouse);
    const [fStatus, fWarehouse] = (e.filters ?? '').split('|');
    return badStatus || badWarehouse || fStatus !== status || fWarehouse !== warehouse;
  });
}

async function selectAndSettle(testid: string, value: string): Promise<void> {
  await page.selectOption(`[data-testid="${testid}"]`, value);
  await page.waitForFunction((v) => location.search.includes(v), value);
  await waitListSettled(page);
}

describe('bộ lọc và phân trang ở bản sau', () => {
  it('đổi trạng thái hay kho không bao giờ hiện kết quả của bộ lọc khác, kể cả khi bộ lọc kia đang trong cache', async () => {
    await startNavProbe(page, 'none');
    await selectAndSettle('filter-status', 'da-nhan'); // chưa có trong cache: vòng xoay, không giữ chỗ bằng "Mới"
    await selectAndSettle('filter-status', 'moi'); // đã có trong cache
    await selectAndSettle('filter-warehouse', 'kho-q1-a');
    await selectAndSettle('filter-status', 'da-nhan');
    await selectAndSettle('filter-warehouse', 'tat-ca'); // da-nhan|tat-ca đã có trong cache
    const r = await stopNavProbe(page);
    expect(r.timeline.length).toBeGreaterThan(5);
    expect(violations(r.timeline)).toEqual([]);
    // Bộ lọc chưa từng xem thì có vòng xoay (không có gì đúng để hiện); bộ lọc đã xem thì hiện ngay.
    expect(r.timeline.some((e) => e.spinner && param(e.search, 'status') === 'da-nhan')).toBe(true);
  });

  it('đổi trang trong cùng bộ lọc giữ trang cũ (mờ) cho tới khi trang mới về, không vòng xoay', async () => {
    const page1 = await tableState(page);
    await startNavProbe(page, 'none');
    await page.click('[data-testid="page-next"]');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="order-table"]')?.dataset.filters === 'moi|tat-ca|2');
    const r = await stopNavProbe(page);
    expect(r.spinnerMs).toBeNull();
    const held = r.timeline.filter((e) => param(e.search, 'page') === '2' && e.filters === 'moi|tat-ca|1');
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((e) => e.placeholder)).toBe(true);
    expect(held[0]!.ids).toEqual(page1!.rows.map((x) => x.id));
  });
});
