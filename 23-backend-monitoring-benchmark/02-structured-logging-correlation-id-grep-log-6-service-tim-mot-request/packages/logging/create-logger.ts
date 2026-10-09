// [PATTERN] Logger chung cho MỌI service: một dòng = một sự kiện JSON theo schema cố định, ghi ra stdout (12factor),
// có trace_id/span_id lấy từ OpenTelemetry context hiện tại, che dữ liệu cá nhân theo đường dẫn trường và trong err.
import { context, isSpanContextValid, trace } from '@opentelemetry/api';
import pino from 'pino';
import { drill } from './drill.js';
import { maskCard, maskPhone, scrubText } from './pii.js';

/** Trường bắt buộc của MỌI dòng log (test/log-schema.test.ts kiểm trên log thật trong Loki và trên stdout). */
export const REQUIRED_FIELDS = ['timestamp', 'level', 'service', 'event', 'message'] as const;
/** Trường bắt buộc thêm cho dòng sinh ra trong một request hay một job. */
export const TRACE_FIELDS = ['trace_id', 'span_id'] as const;

// [PATTERN] Che theo ĐƯỜNG DẪN trường (pino `redact`): nhanh, nhưng chỉ che đúng các đường đã liệt kê — thêm trường mới
// chứa dữ liệu cá nhân mà quên thêm đường ở đây là lộ (phép thử âm `no-nested-redact`). Không với tới chuỗi tự do.
export const PHONE_PATHS = [
  'phone',
  'req.headers["x-msisdn"]',
  'req.body.customer.phone',
  'req.body.customer.contact.phone',
];
export const CARD_PATHS = ['card_number', 'req.body.payment.card.number'];
export const SECRET_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'req.body.payment.card.cvv'];

function redactPaths(): string[] {
  const card = drill('no-nested-redact') ? CARD_PATHS.filter((p) => p !== 'req.body.payment.card.number') : CARD_PATHS;
  return [...PHONE_PATHS, ...card, ...SECRET_PATHS];
}

function censor(value: unknown, path: string[]): unknown {
  if (value === undefined || value === null) return value; // header không gửi: giữ nguyên "không có", không ghi [REDACTED]
  if (typeof value !== 'string' && typeof value !== 'number') return '[REDACTED]';
  const key = path.join('.');
  if (PHONE_PATHS.some((p) => key === p.replace('["', '.').replace('"]', ''))) return maskPhone(String(value));
  if (CARD_PATHS.some((p) => key === p)) return maskCard(String(value));
  return '[REDACTED]';
}

/** Đi qua object đã serialize, che số điện thoại/số thẻ trong MỌI chuỗi (message, stack, cause...). */
function scrubDeep(v: unknown): unknown {
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]));
  return v;
}

// [PATTERN] `redact` KHÔNG che được dữ liệu nằm trong chuỗi tự do như err.message ("timeout cho thuê bao 09...") hay
// stack: serializer của `err` quét bằng regex. Phép thử âm `no-err-scrub` tắt bước này.
function errSerializer(err: unknown): unknown {
  const s = pino.stdSerializers.err(err as Error);
  return drill('no-err-scrub') ? s : scrubDeep(s);
}

export interface AppLogger {
  info(event: string, message: string, fields?: Record<string, unknown>): void;
  warn(event: string, message: string, fields?: Record<string, unknown>): void;
  error(event: string, message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(service: string, opts: { level?: string } = {}): AppLogger {
  // Mặc định pino ghi ĐỒNG BỘ (fs.writeSync) — không mất dòng khi tiến trình chết, nhưng mỗi dòng chặn event loop tới khi
  // ghi xong vào pipe stdout của container. LOG_SYNC=false: sonic-boom ghi bất đồng bộ (nhanh hơn, có thể mất vài dòng
  // cuối nếu tiến trình bị giết). Đo cả hai ở bench/run-overhead.ts.
  const sync = (process.env.LOG_SYNC ?? 'true').trim().toLowerCase() !== 'false';
  const logger = pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    // Thời gian UTC ISO-8601 thay cho epoch ms mặc định: người đọc và Loki đều hiểu, không lệch múi giờ giữa service.
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ level: label }) },
    // `base` thay pid/hostname: chỉ giữ tên service (container đã có id riêng trong hạ tầng thu thập).
    base: { service },
    // [PATTERN] Gắn trace context vào MỌI dòng: đọc span hiện tại từ AsyncLocalStorage của OpenTelemetry.
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};
      const sc = span.spanContext();
      return isSpanContextValid(sc) ? { trace_id: sc.traceId, span_id: sc.spanId } : {};
    },
    redact: { paths: redactPaths(), censor },
    serializers: { err: errSerializer },
  }, pino.destination({ dest: 1, sync }));
  // Bọc lại để MỌI lời gọi có `event` (tên sự kiện ổn định, dùng để lọc) và `message` do người viết đặt — không để
  // pino tự lấy err.message làm message (chuỗi đó có thể chứa dữ liệu cá nhân và không đi qua serializer).
  return {
    info: (event, message, fields = {}) => logger.info({ event, ...fields }, message),
    warn: (event, message, fields = {}) => logger.warn({ event, ...fields }, message),
    error: (event, message, fields = {}) => logger.error({ event, ...fields }, message),
  };
}
