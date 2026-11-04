import type { OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';

export interface PoolSizes {
  interactive: number;
  report: number;
}

/**
 * [PATTERN] Pool là đơn vị cách ly rõ nhất: truy vấn dài của khoang báo cáo không thể lấy kết nối của khoang tương tác.
 * statement_timeout theo khoang chặn truy vấn chạy quá lâu giữ kết nối.
 */
export class DbPools implements OnApplicationShutdown {
  readonly interactive: pg.Pool;
  readonly report: pg.Pool;

  private constructor(interactive: pg.Pool, report: pg.Pool) {
    this.interactive = interactive;
    this.report = report;
  }

  static compartments(connectionString: string, sizes: PoolSizes): DbPools {
    return new DbPools(
      new pg.Pool({ connectionString, max: sizes.interactive, statement_timeout: 2_000, connectionTimeoutMillis: 1_000 }),
      new pg.Pool({ connectionString, max: sizes.report, statement_timeout: 60_000 }),
    );
  }

  /** Bản "trước": mọi loại tải dùng chung một pool, không có giới hạn thời gian. */
  static shared(connectionString: string, size: number): DbPools {
    const pool = new pg.Pool({ connectionString, max: size });
    return new DbPools(pool, pool);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.interactive.end();
    if (this.report !== this.interactive) {
      await this.report.end();
    }
  }
}
