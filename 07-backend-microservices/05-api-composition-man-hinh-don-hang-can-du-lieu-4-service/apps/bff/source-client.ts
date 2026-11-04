import { logEvent } from '../../libs/platform/log';
import { requestContext } from '../../libs/platform/request-context';
import type { BffMetrics } from './metrics';

export type SourceName = 'order' | 'payment' | 'shipping' | 'customer';

/** [PATTERN] Bảng phân loại nguồn: nguồn nào bắt buộc, và timeout riêng từng nguồn thay vì một timeout chung. */
export const SOURCES: Record<SourceName, { required: boolean; timeoutMs: number }> = {
  order: { required: true, timeoutMs: 300 },
  payment: { required: false, timeoutMs: 250 },
  shipping: { required: false, timeoutMs: 250 },
  customer: { required: false, timeoutMs: 250 },
};

export class NotFoundAtSource extends Error {}

export interface SourceUrls {
  orderUrl: string;
  paymentUrl: string;
  shippingUrl: string;
  customerUrl: string;
}

/** Một lời gọi xuống provider: mang correlation id, có timeout riêng, đo theo nguồn. */
export async function callSource<T>(source: SourceName, url: string, metrics: BffMetrics): Promise<T> {
  const context = requestContext.getStore();
  const startedAt = performance.now();
  let status = 0;
  try {
    const response = await fetch(url, {
      headers: { 'x-correlation-id': context?.correlationId ?? '' },
      signal: AbortSignal.timeout(SOURCES[source].timeoutMs),
    });
    status = response.status;
    if (status === 404) {
      throw new NotFoundAtSource(url);
    }
    if (status !== 200) {
      throw new Error(`${source} trả ${status}`);
    }
    return (await response.json()) as T;
  } finally {
    const elapsedMs = performance.now() - startedAt;
    metrics.sourceDuration.observe({ source }, elapsedMs / 1_000);
    logEvent({
      service: 'bff',
      correlationId: context?.correlationId,
      event: 'outbound',
      source,
      status,
      ms: Math.round(elapsedMs),
    });
  }
}
