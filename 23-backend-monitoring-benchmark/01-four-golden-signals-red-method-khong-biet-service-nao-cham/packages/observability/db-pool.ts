// USE cho pool kết nối PostgreSQL (pg.Pool): Utilization = kết nối đang dùng / tối đa, Saturation = số request đang
// chờ lấy kết nối và thời gian chờ, Errors = lỗi của câu lệnh (error.type). Tên theo semantic conventions
// "Database client metrics" (nhóm db.client.connection.* còn ở mức Development, nên viết chuỗi thay vì import).
import type { Attributes } from '@opentelemetry/api';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { performance } from 'node:perf_hooks';
import { HTTP_DURATION_BUCKETS } from './http-server.js';
import { meter, telemetryDisabled } from './init-telemetry.js';

// Bucket khuyến nghị của semantic conventions cho db.client.operation.duration (giây).
const DB_OPERATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

export interface PgPoolObserver {
  /** Lấy một kết nối; đo thời gian chờ (saturation của pool). */
  acquire(): Promise<PoolClient>;
  /** Chạy một câu lệnh trên kết nối đã lấy; đo thời gian câu lệnh. */
  query<R extends QueryResultRow>(client: PoolClient, text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export function observePgPool(pool: Pool, options: { poolName: string; max: number }): PgPoolObserver {
  if (telemetryDisabled()) {
    return { acquire: () => pool.connect(), query: (client, text, values) => client.query(text, values) };
  }
  const m = meter();
  const poolAttr = { 'db.client.connection.pool.name': options.poolName };

  // [PATTERN] Utilization và saturation của pool đọc thẳng từ bộ đếm của pg.Pool lúc SDK thu metric (5 s một lần).
  const count = m.createObservableUpDownCounter('db.client.connection.count', { unit: '{connection}' });
  const max = m.createObservableUpDownCounter('db.client.connection.max', { unit: '{connection}' });
  const pending = m.createObservableUpDownCounter('db.client.connection.pending_requests', { unit: '{request}' });
  m.addBatchObservableCallback(
    (r) => {
      const idle = pool.idleCount;
      r.observe(count, pool.totalCount - idle, { ...poolAttr, 'db.client.connection.state': 'used' });
      r.observe(count, idle, { ...poolAttr, 'db.client.connection.state': 'idle' });
      r.observe(max, options.max, poolAttr);
      r.observe(pending, pool.waitingCount, poolAttr);
    },
    [count, max, pending],
  );

  const waitTime = m.createHistogram('db.client.connection.wait_time', {
    unit: 's',
    description: 'Thời gian chờ lấy được kết nối từ pool',
    advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
  });
  const operation = m.createHistogram('db.client.operation.duration', {
    unit: 's',
    description: 'Thời gian một câu lệnh SQL, tính từ lúc gửi tới lúc nhận đủ kết quả',
    advice: { explicitBucketBoundaries: DB_OPERATION_BUCKETS },
  });

  return {
    async acquire() {
      const started = performance.now();
      try {
        return await pool.connect();
      } finally {
        waitTime.record((performance.now() - started) / 1000, poolAttr);
      }
    },
    async query(client, text, values) {
      // Tên thao tác là từ khóa đầu (SELECT, INSERT, BEGIN...): tập giá trị nhỏ, không đưa câu SQL hay tham số vào label.
      const attributes: Attributes = {
        'db.system.name': 'postgresql',
        'db.operation.name': text.trimStart().split(/\s/, 1)[0]!.toUpperCase(),
      };
      const started = performance.now();
      try {
        return await client.query(text, values);
      } catch (err) {
        attributes['error.type'] = (err as { code?: string }).code ?? (err as Error).name;
        throw err;
      } finally {
        operation.record((performance.now() - started) / 1000, attributes);
      }
    },
  };
}
