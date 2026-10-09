// Trace context trong một tiến trình (AsyncLocalStorage) và qua HTTP (header `traceparent` của W3C Trace Context).
// Bài này chỉ cần trace_id/span_id để gắn vào log; không xuất span đi đâu (xuất trace là bài 23/03).
import { context, propagation, ROOT_CONTEXT, SpanKind, trace, type Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

export const TRACER_NAME = 'lab-logging';

export function initTracing(): void {
  // [PATTERN] AsyncLocalStorage giữ span hiện tại qua mọi await/callback: logger đọc nó, không ai phải truyền tay id.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  // [PATTERN] Dùng `traceparent` chuẩn W3C làm correlation id thay cho header tự chế (X-Request-Id).
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  // Không có span processor/exporter: span chỉ để sinh id và quan hệ cha–con. Sampler mặc định ParentBased(AlwaysOn).
  trace.setGlobalTracerProvider(new BasicTracerProvider());
}

/** Chạy `fn` trong một span SERVER, nối tiếp trace của upstream nếu request mang `traceparent`, nếu không thì bắt đầu trace mới. */
export async function withServerSpan<T>(
  headers: Record<string, string | string[] | undefined>,
  name: string,
  fn: () => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  const parent = propagation.extract(ROOT_CONTEXT, headers);
  const span = trace.getTracer(TRACER_NAME).startSpan(name, { kind: SpanKind.SERVER, attributes }, parent);
  try {
    return await context.with(trace.setSpan(parent, span), fn);
  } finally {
    span.end();
  }
}

/** Header cho lời gọi HTTP ra ngoài: thêm `traceparent` (và `tracestate` nếu có) của span hiện tại. */
export function traceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}
