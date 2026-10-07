/** Loại lỗi kết nối mà API đổi thành 503 (để k6 và log đếm riêng từng loại). */
export type DbConnectionErrorKind =
  | 'db_too_many_clients' // PostgreSQL từ chối: vượt max_connections (SQLSTATE 53300)
  | 'db_pool_timeout' // pool trong pod hết kết nối, chờ quá connectionTimeoutMillis
  | 'pooler_wait_timeout' // PgBouncer hết kết nối thật, client chờ quá query_wait_timeout
  | 'pooler_max_client_conn' // PgBouncer từ chối: vượt max_client_conn
  | 'db_unreachable' // không mở được TCP tới DB/PgBouncer
  | 'db_connection_lost'; // kết nối bị đóng giữa chừng

export const DB_CONNECTION_ERROR_KINDS: readonly DbConnectionErrorKind[] = [
  'db_too_many_clients',
  'db_pool_timeout',
  'pooler_wait_timeout',
  'pooler_max_client_conn',
  'db_unreachable',
  'db_connection_lost',
];

export function classifyDbError(err: unknown): DbConnectionErrorKind | undefined {
  if (!(err instanceof Error)) return undefined;
  const code = (err as { code?: string }).code;
  if (code === '53300') return 'db_too_many_clients';
  if (err.message === 'timeout exceeded when trying to connect') return 'db_pool_timeout';
  if (err.message.includes('query_wait_timeout')) return 'pooler_wait_timeout';
  if (err.message.includes('no more connections allowed')) return 'pooler_max_client_conn';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'db_unreachable';
  if (err.message.includes('Connection terminated')) return 'db_connection_lost';
  return undefined;
}
