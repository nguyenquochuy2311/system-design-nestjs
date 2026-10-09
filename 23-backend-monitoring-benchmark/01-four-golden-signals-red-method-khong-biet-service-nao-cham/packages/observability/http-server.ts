// RED phía server: một histogram `http.server.request.duration` (giây) cho mọi request. Rate = số đếm của histogram,
// Errors = phần có status 5xx, Duration = các bucket. Không cần ba metric riêng.
import type { Attributes, Histogram } from '@opentelemetry/api';
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from '@opentelemetry/semantic-conventions';
import type { FastifyInstance } from 'fastify';
import { performance } from 'node:perf_hooks';
import { meter, telemetryDisabled } from './init-telemetry.js';

// Bucket khuyến nghị của semantic conventions cho http.*.request.duration (đơn vị giây). Bucket mặc định của SDK
// là [0, 5, 10, 25, ..., 10000] — dành cho mili giây — nên dùng mặc định với đơn vị giây thì mọi request rơi vào
// bucket đầu và p95 vô nghĩa.
export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

const KNOWN_METHODS = new Set(['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE']);

/** Semantic conventions: method lạ ghi là `_OTHER`, để client gửi method tùy ý không tạo series mới. */
export function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return KNOWN_METHODS.has(upper) ? upper : '_OTHER';
}

export function registerHttpServerMetrics(app: FastifyInstance): void {
  if (telemetryDisabled()) return;
  const duration: Histogram = meter().createHistogram(METRIC_HTTP_SERVER_REQUEST_DURATION, {
    unit: 's',
    description: 'Thời gian xử lý request HTTP phía server',
    advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
  });

  // Request bị client bỏ ngang (gateway hết timeout, khách đóng tab) không bao giờ tới onResponse: Node không phát
  // 'finish' trên socket đã đóng. Không ghi riêng thì đúng những request chậm nhất biến mất khỏi histogram của
  // service chậm (đã kiểm: checkout không đếm request mà gateway bỏ sau 5 s). Ghi lại lúc client bỏ, không có status
  // code, error.type = "request_aborted".
  const startedAt = new WeakMap<object, number>();
  app.addHook('onRequest', async (request) => {
    startedAt.set(request, performance.now());
  });
  app.addHook('onRequestAbort', async (request) => {
    const attributes: Attributes = {
      [ATTR_HTTP_REQUEST_METHOD]: normalizeMethod(request.method),
      [ATTR_ERROR_TYPE]: 'request_aborted',
    };
    if (request.routeOptions.url) attributes[ATTR_HTTP_ROUTE] = request.routeOptions.url;
    duration.record((performance.now() - (startedAt.get(request) ?? performance.now())) / 1000, attributes);
  });

  app.addHook('onResponse', async (request, reply) => {
    const attributes: Attributes = {
      [ATTR_HTTP_REQUEST_METHOD]: normalizeMethod(request.method),
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: reply.statusCode,
    };
    // [PATTERN] Label là route template ("/orders/:id") do router trả về, KHÔNG phải URL thô ("/orders/123"):
    // số series không phụ thuộc số id khách gọi. Request không khớp route nào thì không có http.route
    // (semantic conventions: chỉ đặt khi biết), thay vì ghi đường dẫn khách tự gõ.
    const route = request.routeOptions.url;
    if (route) attributes[ATTR_HTTP_ROUTE] = route;
    if (reply.statusCode >= 500) attributes[ATTR_ERROR_TYPE] = String(reply.statusCode);
    duration.record(reply.elapsedTime / 1000, attributes);
  });
}
