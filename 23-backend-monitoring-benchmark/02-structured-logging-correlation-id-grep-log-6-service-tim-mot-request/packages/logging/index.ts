// Gói logging dùng chung: một dòng setupLogging(service) ở đầu main.ts của mọi service.
import { createLogger, type AppLogger } from './create-logger.js';
import { legacyLogger } from './legacy-log.js';
import { initTracing } from './trace-context.js';

export { createLogger, REQUIRED_FIELDS, TRACE_FIELDS, type AppLogger } from './create-logger.js';
export { legacyLogger } from './legacy-log.js';
export { withServerSpan, traceHeaders } from './trace-context.js';
export { publishWithContext, processWithContext, TRACE_CARRIER_KEY } from './queue-context.js';
export { findPii, scrubText, luhnValid } from './pii.js';
export { drill } from './drill.js';

/** LOG_MODE: `truoc` (console.log tự do, không trace context), `sau` (pattern), `off` (như `sau` nhưng không ghi log — đo overhead). */
export type LogMode = 'truoc' | 'sau' | 'off';
export function logMode(): LogMode {
  const m = (process.env.LOG_MODE ?? 'sau').trim();
  return m === 'truoc' || m === 'off' ? m : 'sau';
}

export function setupLogging(service: string): AppLogger {
  const mode = logMode();
  if (mode === 'truoc') return legacyLogger(service);
  initTracing();
  return createLogger(service, mode === 'off' ? { level: 'silent' } : {});
}
