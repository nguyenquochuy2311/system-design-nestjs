import { createHash } from 'node:crypto';

/**
 * MD5 hex không salt — CÁCH LƯU CŨ, tái hiện triệu chứng. MD5 thiết kế để nhanh: phần cứng phổ thông
 * thử hàng tỷ ứng viên mỗi giây, và không salt nên hai người cùng mật khẩu có cùng chuỗi này.
 * Chỉ dùng ở bản "trước" và làm đầu vào cho migration bọc; KHÔNG dùng để lưu mật khẩu mới.
 */
export function md5Hex(password: string): string {
  return createHash('md5').update(password, 'utf8').digest('hex');
}
