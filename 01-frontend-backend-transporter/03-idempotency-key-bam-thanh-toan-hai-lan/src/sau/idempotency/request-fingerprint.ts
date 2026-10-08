import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/** JSON với khóa object sắp theo thứ tự chữ cái ở mọi tầng: cùng payload thì cùng chuỗi, dù client đổi thứ tự trường. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** [PATTERN] Dấu vân tay của request: SHA-256 của method + path + body đã chuẩn hóa. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`).digest('hex');
}

/**
 * Giá trị header `Idempotency-Key`. Bản nháp IETF (-07, mục 2.1) định nghĩa nó là Structured Field kiểu String
 * (`"..."`); lab nhận cả dạng không có ngoặc kép như ví dụ của Stripe. Tối đa 255 ký tự (giới hạn của Stripe).
 */
export function parseIdempotencyKey(header: unknown): string {
  const raw = typeof header === 'string' ? header.trim() : '';
  const value = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  if (!/^[\x21\x23-\x5B\x5D-\x7E]{1,255}$/.test(value)) {
    // Bản nháp, mục 2.7: thiếu khóa ở endpoint bắt buộc có khóa thì trả 400.
    throw new BadRequestException({
      statusCode: 400,
      error: 'idempotency_key_required',
      message: 'Endpoint này bắt buộc header Idempotency-Key (1 – 255 ký tự ASCII in được)',
    });
  }
  return value;
}
