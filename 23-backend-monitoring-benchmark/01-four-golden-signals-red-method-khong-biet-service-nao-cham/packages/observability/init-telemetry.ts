// Khởi tạo OpenTelemetry SDK (chỉ tín hiệu metric) cho MỌI service của lab. Mỗi service gọi initTelemetry() một
// lần ở dòng đầu main.ts; tên metric, đơn vị, bucket và label do gói này quyết định, nên 3 service (và service
// thứ 4, thứ 8 sau này) có cùng một bộ RED/USE mà không đội nào phải tự đặt tên.
import { metrics, type Meter } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

export const SCOPE_NAME = 'lab-observability';

/** Biến chuẩn của OpenTelemetry: OTEL_SDK_DISABLED=true tắt toàn bộ (bản "trước" và lượt đo overhead). */
export function telemetryDisabled(): boolean {
  return (process.env.OTEL_SDK_DISABLED ?? '').trim().toLowerCase() === 'true';
}

export function meter(): Meter {
  return metrics.getMeter(SCOPE_NAME);
}

export interface Telemetry {
  enabled: boolean;
  serviceName: string;
  shutdown(): Promise<void>;
}

export function initTelemetry(): Telemetry {
  // [PATTERN] service.name là resource attribute; Collector chuyển nó thành label `service_name` trên mọi series.
  // Service quên đặt OTEL_SERVICE_NAME sẽ hiện là "unknown_service:node" (giá trị mặc định của SDK) — phép thử âm #2.
  const serviceName =
    process.env.OTEL_SERVICE_NAME?.trim() || String(defaultResource().attributes[ATTR_SERVICE_NAME]);
  if (telemetryDisabled()) return { enabled: false, serviceName, shutdown: async () => {} };

  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318').replace(/\/$/, '');
  const reader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
    // Chu kỳ đẩy ngắn (5 s) để game day thấy thay đổi nhanh; production thường 15–60 s.
    exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 5000),
  });
  // Resource chỉ có service.name (không thêm telemetry.sdk.*, host.*): Collector đưa service.name thành label.
  const provider = new MeterProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    readers: [reader],
  });
  metrics.setGlobalMeterProvider(provider);
  registerRuntimeMetrics();
  return { enabled: true, serviceName, shutdown: () => provider.shutdown() };
}

/**
 * USE cho tiến trình Node: CPU (utilization), bộ nhớ, và event loop delay (saturation — Node nghẽn ở event loop
 * trước khi CPU máy đầy). Tên theo semantic conventions "Node.js runtime" và "process".
 */
function registerRuntimeMetrics(): void {
  const m = meter();
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  let lastElu = performance.eventLoopUtilization();

  const delayP99 = m.createObservableGauge('nodejs.eventloop.delay.p99', {
    unit: 's',
    description: 'p99 độ trễ event loop trong chu kỳ đẩy vừa qua (gồm cả resolution 10 ms của bộ lấy mẫu)',
  });
  const delayMax = m.createObservableGauge('nodejs.eventloop.delay.max', { unit: 's' });
  const elu = m.createObservableGauge('nodejs.eventloop.utilization', { unit: '1' });
  const cpuTime = m.createObservableCounter('process.cpu.time', { unit: 's' });
  const memory = m.createObservableUpDownCounter('process.memory.usage', { unit: 'By' });

  m.addBatchObservableCallback(
    (r) => {
      r.observe(delayP99, loopDelay.percentile(99) / 1e9);
      r.observe(delayMax, loopDelay.max / 1e9);
      loopDelay.reset(); // mỗi chu kỳ đẩy là một cửa sổ riêng, không cộng dồn từ lúc khởi động
      const now = performance.eventLoopUtilization();
      r.observe(elu, performance.eventLoopUtilization(now, lastElu).utilization);
      lastElu = now;
      const cpu = process.cpuUsage();
      r.observe(cpuTime, cpu.user / 1e6, { 'cpu.mode': 'user' });
      r.observe(cpuTime, cpu.system / 1e6, { 'cpu.mode': 'system' });
      r.observe(memory, process.memoryUsage.rss());
    },
    [delayP99, delayMax, elu, cpuTime, memory],
  );
}
