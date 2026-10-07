import { createHmac, timingSafeEqual } from 'node:crypto';

// Phiên đăng nhập của lab: cookie `sid=u<id>.<chữ ký>`, chữ ký HMAC của id bằng SESSION_SECRET. Đủ để route có guard
// phân biệt được khách; không có đăng nhập thật vì bài này chỉ cần biết "response này là của riêng ai".
export const SESSION_COOKIE = 'sid';

const sign = (secret: string, userId: number) => createHmac('sha256', secret).update(String(userId)).digest('base64url').slice(0, 22);

export const sessionToken = (secret: string, userId: number): string => `u${userId}.${sign(secret, userId)}`;

export function verifySession(secret: string, token: string | undefined): number | null {
  const m = token ? /^u(\d{1,9})\.([\w-]{22})$/.exec(token) : null;
  if (!m) return null;
  const userId = Number(m[1]);
  const expected = Buffer.from(sign(secret, userId));
  const given = Buffer.from(m[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
