import DataLoader from 'dataloader';
import type { BffMetrics } from './metrics';
import { callSource, type SourceName, type SourceUrls } from './source-client';

const MAX_BATCH_SIZE = 50;

function batchLoader<Row>(
  source: SourceName,
  metrics: BffMetrics,
  urlFor: (ids: readonly string[]) => string,
  keyOf: (row: Row) => string,
): DataLoader<string, Row | null> {
  return new DataLoader(
    async (ids) => {
      const rows = await callSource<Row[]>(source, urlFor(ids), metrics);
      const byId = new Map(rows.map((row) => [keyOf(row), row]));
      return ids.map((id) => byId.get(id) ?? null);
    },
    { maxBatchSize: MAX_BATCH_SIZE },
  );
}

export interface Payment {
  order_id: string;
  status: string;
}
export interface Shipment {
  order_id: string;
  status: string;
  carrier: string;
}
export interface Customer {
  id: string;
  name: string;
  tier: string;
}

/**
 * [PATTERN] Gom các yêu cầu cùng tick thành một lời gọi lô, tránh N+1 xuyên service. Tạo mới cho mỗi request: DataLoader có
 * cache, dùng chung giữa các request là lộ dữ liệu của khách này cho khách khác.
 */
export function createLoaders(urls: SourceUrls, metrics: BffMetrics) {
  return {
    payment: batchLoader<Payment>(
      'payment',
      metrics,
      (ids) => `${urls.paymentUrl}/payments?orderIds=${ids.join(',')}`,
      (row) => row.order_id,
    ),
    shipping: batchLoader<Shipment>(
      'shipping',
      metrics,
      (ids) => `${urls.shippingUrl}/shipments?orderIds=${ids.join(',')}`,
      (row) => row.order_id,
    ),
    customer: batchLoader<Customer>(
      'customer',
      metrics,
      (ids) => `${urls.customerUrl}/customers?ids=${ids.join(',')}`,
      (row) => row.id,
    ),
  };
}
