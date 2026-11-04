import type { OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';

// Tiền lưu bằng bigint; pg mặc định trả chuỗi. Số tiền của lab nằm xa giới hạn an toàn của Number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

/** Pool riêng của một service, nối bằng role riêng của nó. Nest tự đóng pool khi app tắt. */
export class Database implements OnApplicationShutdown {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, max = 10) {
    this.pool = new pg.Pool({ connectionString, max });
  }

  query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
