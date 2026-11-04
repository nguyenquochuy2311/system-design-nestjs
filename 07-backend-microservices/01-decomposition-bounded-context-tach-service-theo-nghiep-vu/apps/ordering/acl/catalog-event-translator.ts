/** Mô hình của Ordering: chỉ những gì cần để bán. Không có mô tả, ảnh hay danh mục của Catalog. */
export interface SnapshotUpdate {
  sku: string;
  productName: string;
  unitPriceVnd: number;
  priceVersion: number;
}

export type Translation =
  | { kind: 'apply'; update: SnapshotUpdate }
  | { kind: 'ignore' }
  | { kind: 'quarantine'; reason: string };

type CatalogEvent = Record<string, unknown>;

function fromV1(event: CatalogEvent) {
  return { productName: event.displayName, unitPriceVnd: event.priceVnd, priceVersion: event.priceVersion };
}

function fromV2(event: CatalogEvent) {
  const listPrice = event.listPrice as { amountVnd?: unknown } | undefined;
  return { productName: event.title, unitPriceVnd: listPrice?.amountVnd, priceVersion: event.revision };
}

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const isNonEmptyText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * [PATTERN] Anti-Corruption Layer: mọi hiểu biết về hình dạng sự kiện của Catalog nằm trong file này. Catalog đổi tên
 * trường thì chỉ sửa ở đây, phần còn lại của Ordering vẫn nói bằng SnapshotUpdate. Trường lạ bị bỏ qua; sự kiện không
 * dịch được thì cách ly chứ không ném lỗi, để một sự kiện sai không chặn hàng đợi hay làm dừng Ordering.
 */
export function translateCatalogEvent(raw: unknown): Translation {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'quarantine', reason: 'Sự kiện không phải object' };
  }
  const event = raw as CatalogEvent;
  if (event.eventType !== 'ProductPriceChanged') {
    return { kind: 'ignore' };
  }
  const fields = event.schemaVersion === 2 ? fromV2(event) : fromV1(event);
  if (
    isNonEmptyText(event.sku) &&
    isNonEmptyText(fields.productName) &&
    isPositiveInteger(fields.unitPriceVnd) &&
    isPositiveInteger(fields.priceVersion)
  ) {
    return {
      kind: 'apply',
      update: {
        sku: event.sku,
        productName: fields.productName,
        unitPriceVnd: fields.unitPriceVnd,
        priceVersion: fields.priceVersion,
      },
    };
  }
  return { kind: 'quarantine', reason: `Không dịch được ProductPriceChanged schemaVersion=${String(event.schemaVersion)}` };
}
