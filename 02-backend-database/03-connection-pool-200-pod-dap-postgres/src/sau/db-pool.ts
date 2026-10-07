import pg from 'pg';
import { PGBOUNCER_URLS } from '../shared/config';

/** Pod chờ lấy kết nối từ pool của chính nó tối đa chừng này, quá thì trả 503 ngay thay vì treo. */
export const POOL_CONNECTION_TIMEOUT_MS = 2000;

/**
 * [PATTERN] PHIÊN BẢN "SAU": pod nối tới PgBouncer (transaction mode), không nối thẳng PostgreSQL.
 * Kết nối pod -> PgBouncer rẻ (PgBouncer giữ hàng nghìn được); kết nối PgBouncer -> PostgreSQL cố định
 * = 2 instance × default_pool_size, không phụ thuộc số pod. Pod chia cho hai instance theo podIndex.
 *
 * Lưu ý: connectionTimeoutMillis chỉ bao khoảng chờ trong pool của pod. Khi PgBouncer hết kết nối thật,
 * client đã "kết nối" xong và chờ ở hàng đợi của PgBouncer; khoảng chờ đó do query_wait_timeout của PgBouncer cắt.
 */
export function createPooledPool(podIndex: number, max = Number(process.env.POOL_MAX || 10)): pg.Pool {
  const url = PGBOUNCER_URLS[podIndex % PGBOUNCER_URLS.length]!;
  return new pg.Pool({
    connectionString: url,
    max, // [PATTERN] pool nhỏ phía app: chỉ cần đủ cho số request đồng thời của một pod
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS, // [PATTERN] lỗi nhanh khi pod nghẽn
    application_name: `pod-${podIndex}`,
  });
}
