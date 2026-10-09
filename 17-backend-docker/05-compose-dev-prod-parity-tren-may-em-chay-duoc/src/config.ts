import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Nạp .env nếu có (máy dev); biến đã đặt trong môi trường (CI, phép thử) được ưu tiên hơn file. */
export function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
  }
}

/** Đọc biến môi trường bắt buộc. Không có giá trị mặc định cho chuỗi kết nối: thiếu thì dừng ngay, nói rõ thiếu gì. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name} (chép .env.example thành .env hoặc đặt trong CI)`);
  return value;
}
