import pg from 'pg';
import { DIRECT_URL } from '../shared/config';

/**
 * PHIÊN BẢN "TRƯỚC": mỗi pod mở pool tới 20 kết nối THẲNG tới PostgreSQL, giữ cấu hình mặc định của node-postgres:
 * - connectionTimeoutMillis = 0: khi pool của pod đã hết kết nối, request chờ lấy kết nối mãi mãi;
 * - idleTimeoutMillis = 10 s: kết nối mở lúc cao điểm vẫn chiếm một chỗ trong max_connections 10 giây sau khi rảnh.
 * Tổng kết nối tiềm năng = số pod × 20, tăng theo autoscale, trong khi trần của DB đứng yên.
 */
export function createDirectPool(podIndex: number, max = Number(process.env.POOL_MAX || 20)): pg.Pool {
  return new pg.Pool({ connectionString: DIRECT_URL, max, application_name: `pod-${podIndex}` });
}
