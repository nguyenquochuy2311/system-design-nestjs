import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomBytes } from 'node:crypto';

// [PATTERN] CSRF double-submit CÓ KÝ (OWASP "Signed Double-Submit Cookie").
// Token = `<message>.<mac>` với mac = HMAC(csrfSecret, sessionId + '.' + message).
// - message ngẫu nhiên: cookie `csrf` (đọc được bằng JS) và header `X-CSRF-Token` phải khớp nhau (double-submit).
// - mac buộc token gắn với ĐÚNG phiên: site khác không biết sessionId (cookie __Host-sid là HttpOnly) và không có
//   csrfSecret nên không giả được token hợp lệ cho phiên của nạn nhân.
// Hạn chế đã biết: XSS chạy ngay trong trang vẫn đọc được cookie `csrf` → CSRF không chống được XSS (xem README 3.4).

function mac(csrfSecret: string, sessionId: string, message: string): string {
  return createHmac('sha256', csrfSecret).update(`${sessionId}.${message}`).digest('hex');
}

export function mintCsrfToken(csrfSecret: string, sessionId: string): string {
  const message = randomBytes(18).toString('hex');
  return `${message}.${mac(csrfSecret, sessionId, message)}`;
}

export function verifyCsrfToken(csrfSecret: string, sessionId: string, cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken) return false;
  if (!safeEqualStr(cookieToken, headerToken)) return false; // double-submit: cookie phải khớp header
  const dot = headerToken.lastIndexOf('.');
  if (dot <= 0) return false;
  const message = headerToken.slice(0, dot);
  const given = headerToken.slice(dot + 1);
  return safeEqualStr(given, mac(csrfSecret, sessionId, message));
}

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
