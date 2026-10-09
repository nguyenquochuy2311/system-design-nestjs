// Gọi HTTP giữa các service: JSON + header `traceparent` của span hiện tại (bản "trước" không có tracer nên không thêm gì).
import { traceHeaders } from '../../packages/logging/index.js';

export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
}

export async function postJson<T = unknown>(url: string, body: unknown, timeoutMs = 5000): Promise<JsonResponse<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: traceHeaders({ 'content-type': 'application/json' }), // [PATTERN] traceparent đi theo mọi lời gọi
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

export const listenPort = (fallback: number) => Number(process.env.PORT ?? fallback);
