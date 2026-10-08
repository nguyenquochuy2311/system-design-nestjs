import { createHmac, timingSafeEqual } from 'node:crypto';

/** Vị trí "dòng cuối cùng tôi đã thấy": đúng hai giá trị của khóa sắp xếp (created_at, id). */
export interface CursorPosition {
  /** ISO 8601, giờ UTC, đủ 6 chữ số micro giây, lấy nguyên từ PostgreSQL. */
  createdAt: string;
  /** bigint dạng chuỗi. */
  id: string;
}

export class InvalidCursorError extends Error {}

const VERSION = 1;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID = /^[1-9]\d{0,18}$/;
const MAX_BIGINT = 9223372036854775807n;

interface Payload {
  v: number;
  m: number;
  t: string;
  i: string;
}

/**
 * [PATTERN] Cursor mờ (opaque): client chỉ biết "đưa lại chuỗi này để lấy trang sau".
 * Dạng `base64url(JSON).base64url(HMAC-SHA256)`. Chữ ký chống sửa tay; phiên bản `v` cho phép đổi khóa sắp xếp sau này;
 * `m` buộc cursor vào đúng merchant đã phát nó.
 */
export function createCursorCodec(secret: string) {
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64url');

  return {
    encode(merchantId: number, pos: CursorPosition): string {
      const payload: Payload = { v: VERSION, m: merchantId, t: pos.createdAt, i: pos.id };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${body}.${sign(body)}`;
    },

    decode(merchantId: number, cursor: string): CursorPosition {
      const parts = cursor.split('.');
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new InvalidCursorError('cursor sai cấu trúc');
      const [body, mac] = parts as [string, string];
      // [PATTERN] Kiểm chữ ký trước khi tin bất kỳ byte nào trong cursor (so sánh thời gian hằng).
      if (!sameMac(sign(body), mac)) throw new InvalidCursorError('chữ ký cursor không khớp');
      const payload = parsePayload(body);
      // [PATTERN] Kiểm định dạng: chữ ký chỉ chứng minh cursor do server phát, không chứng minh đúng phiên bản hiện tại.
      if (!isCurrentFormat(payload)) throw new InvalidCursorError('cursor sai phiên bản hoặc định dạng');
      if (payload.m !== merchantId) throw new InvalidCursorError('cursor thuộc merchant khác');
      return { createdAt: payload.t, id: payload.i };
    },
  };
}

export type CursorCodec = ReturnType<typeof createCursorCodec>;

function sameMac(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parsePayload(body: string): Partial<Payload> {
  try {
    const value: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null ? (value as Partial<Payload>) : {};
  } catch {
    throw new InvalidCursorError('cursor không giải mã được');
  }
}

function isCurrentFormat(p: Partial<Payload>): p is Payload {
  return (
    p.v === VERSION &&
    Number.isSafeInteger(p.m) &&
    typeof p.t === 'string' && CREATED_AT.test(p.t) && !Number.isNaN(Date.parse(p.t)) &&
    typeof p.i === 'string' && ID.test(p.i) && BigInt(p.i) <= MAX_BIGINT
  );
}
