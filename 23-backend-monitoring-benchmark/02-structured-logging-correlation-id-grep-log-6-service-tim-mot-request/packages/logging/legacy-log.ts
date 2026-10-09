// Bản "TRƯỚC": mỗi đội tự log bằng console.log/console.error theo kiểu riêng — chuỗi tự do, giờ địa phương hoặc không có
// giờ, in nguyên object (kể cả số điện thoại, số thẻ), lỗi in kèm stack trên nhiều dòng. Không có trace_id.
// Cùng chữ ký với logger mới để mã nghiệp vụ của 4 service giữ nguyên giữa hai bản (chỉ đổi LOG_MODE).
import type { AppLogger } from './create-logger.js';

const STYLES: Record<string, (msg: string) => string> = {
  gateway: (m) => `[${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}] ${m}`,
  topup: (m) => `topup: ${m}`, // không có giờ: dựa vào giờ của Docker
  'bank-adapter': (m) => m,
  ledger: (m) => `${new Date().toISOString()} [ledger] ${m}`,
};

export function legacyLogger(service: string): AppLogger {
  const style = STYLES[service] ?? ((m: string) => `${service} ${m}`);
  const print = (out: (...a: unknown[]) => void) => (_event: string, message: string, fields: Record<string, unknown> = {}) =>
    Object.keys(fields).length ? out(style(message), fields) : out(style(message));
  return { info: print(console.log), warn: print(console.warn), error: print(console.error) };
}
