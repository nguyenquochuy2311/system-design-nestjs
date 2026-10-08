import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Lab này KHÔNG về băm mật khẩu (xem bài 19/01 cho Argon2id). Dùng scrypt của node:crypto cho gọn,
// không thêm phụ thuộc: đủ để có bước "xác minh mật khẩu" trước khi tạo phiên.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
