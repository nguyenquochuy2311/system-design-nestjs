import { randomUUID } from 'node:crypto';

export type EventSchema = 'v1' | 'v2';

export interface ChangedProduct {
  sku: string;
  display_name: string;
  list_price_vnd: number;
  price_version: number;
}

/**
 * Hợp đồng sự kiện là thứ duy nhất Catalog công bố ra ngoài; nó tách khỏi tên cột của bảng products.
 * v2 là lần đội Catalog đổi tên trường: displayName → title, priceVnd → listPrice.amountVnd, priceVersion → revision.
 */
export function toPublishedEvent(product: ChangedProduct, schema: EventSchema): Record<string, unknown> {
  const envelope = {
    eventType: 'ProductPriceChanged',
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    sku: product.sku,
  };
  if (schema === 'v2') {
    return {
      ...envelope,
      schemaVersion: 2,
      title: product.display_name,
      listPrice: { amountVnd: product.list_price_vnd },
      revision: product.price_version,
    };
  }
  return {
    ...envelope,
    schemaVersion: 1,
    displayName: product.display_name,
    priceVnd: product.list_price_vnd,
    priceVersion: product.price_version,
  };
}
