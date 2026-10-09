// RED phía client: mỗi lời gọi sang service khác ghi `http.client.request.duration` kèm server.address. Nhờ đó
// "gateway chậm vì chờ checkout" phân biệt được với "checkout tự chậm" (xem truy vấn khoanh vùng trong README).
import type { Attributes, Histogram } from '@opentelemetry/api';
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  METRIC_HTTP_CLIENT_REQUEST_DURATION,
} from '@opentelemetry/semantic-conventions';
import { performance } from 'node:perf_hooks';
import { HTTP_DURATION_BUCKETS, normalizeMethod } from './http-server.js';
import { meter, telemetryDisabled } from './init-telemetry.js';

let histogram: Histogram | undefined;
// Tạo instrument lúc gọi đầu tiên (sau initTelemetry): API metric của OpenTelemetry không có proxy như tracing,
// instrument tạo trước khi đăng ký MeterProvider sẽ là no-op mãi mãi.
function clientDuration(): Histogram {
  histogram ??= meter().createHistogram(METRIC_HTTP_CLIENT_REQUEST_DURATION, {
    unit: 's',
    description: 'Thời gian một lời gọi HTTP ra service khác, tới khi đọc xong body',
    advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
  });
  return histogram;
}

export interface JsonResponse<T> {
  status: number;
  body: T | undefined;
}

export async function requestJson<T>(
  url: string,
  init: { method?: string; body?: unknown; timeoutMs: number },
): Promise<JsonResponse<T>> {
  const target = new URL(url);
  const method = init.method ?? 'GET';
  const started = performance.now();
  const attributes: Attributes = {
    [ATTR_HTTP_REQUEST_METHOD]: normalizeMethod(method),
    [ATTR_SERVER_ADDRESS]: target.hostname,
    [ATTR_SERVER_PORT]: Number(target.port || 80),
  };
  const record = () => {
    if (!telemetryDisabled()) clientDuration().record((performance.now() - started) / 1000, attributes);
  };
  try {
    const res = await fetch(target, {
      method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    const text = await res.text();
    attributes[ATTR_HTTP_RESPONSE_STATUS_CODE] = res.status;
    if (res.status >= 500) attributes[ATTR_ERROR_TYPE] = String(res.status);
    record();
    return { status: res.status, body: text ? (JSON.parse(text) as T) : undefined };
  } catch (err) {
    // Hết giờ hay lỗi kết nối: không có status code, error.type cho biết loại lỗi (semantic conventions).
    attributes[ATTR_ERROR_TYPE] = (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).name;
    record();
    throw err;
  }
}
