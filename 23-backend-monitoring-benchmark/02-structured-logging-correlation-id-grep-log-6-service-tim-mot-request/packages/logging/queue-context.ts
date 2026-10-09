// [PATTERN] Truyền trace context QUA HÀNG ĐỢI: producer ghi `traceparent` vào dữ liệu job, consumer đọc lại và chạy
// handler trong span con của trace đó. Thiếu bước này, log của consumer có trace_id MỚI và chuỗi đứt ngay sau hàng đợi.
// (BullMQ có tùy chọn `telemetry` + gói bullmq-otel làm việc tương tự; lab viết tay để thấy rõ cơ chế.)
import { context, propagation, ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api';
import { drill } from './drill.js';
import { TRACER_NAME } from './trace-context.js';

/** Khóa đặt carrier trong dữ liệu job. Chỉ chứa header W3C (`traceparent`, `tracestate`), không chứa dữ liệu nghiệp vụ. */
export const TRACE_CARRIER_KEY = '_trace';
export type TraceCarrier = Record<string, string>;
export type WithTraceCarrier<T> = T & { [TRACE_CARRIER_KEY]?: TraceCarrier };

/**
 * Producer: chạy `publish` trong span PRODUCER và trao cho nó dữ liệu job đã gắn carrier của span này.
 * Ví dụ: `await publishWithContext('bank-charge', data, (d) => queue.add('charge', d))`.
 */
export async function publishWithContext<T extends object, R>(
  queueName: string,
  data: T,
  publish: (data: WithTraceCarrier<T>) => Promise<R>,
): Promise<R> {
  const span = trace.getTracer(TRACER_NAME).startSpan(`publish ${queueName}`, {
    kind: SpanKind.PRODUCER,
    attributes: { 'messaging.system': 'bullmq', 'messaging.destination.name': queueName },
  });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => {
      const carrier: TraceCarrier = {};
      if (!drill('no-queue-context')) propagation.inject(context.active(), carrier); // [PATTERN] ghi traceparent
      return publish({ ...data, [TRACE_CARRIER_KEY]: carrier });
    });
  } finally {
    span.end();
  }
}

/** Consumer: khôi phục context từ carrier trong job rồi chạy handler trong span CONSUMER (con của span PRODUCER). */
export async function processWithContext<T>(
  queueName: string,
  job: { id?: string; data: WithTraceCarrier<object> },
  handler: () => Promise<T>,
): Promise<T> {
  const parent = propagation.extract(ROOT_CONTEXT, job.data[TRACE_CARRIER_KEY] ?? {}); // [PATTERN] đọc traceparent
  const span = trace.getTracer(TRACER_NAME).startSpan(
    `process ${queueName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: { 'messaging.system': 'bullmq', 'messaging.destination.name': queueName, 'messaging.message.id': job.id ?? '' },
    },
    parent,
  );
  try {
    return await context.with(trace.setSpan(parent, span), handler);
  } finally {
    span.end();
  }
}
