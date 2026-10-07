import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../shared/config';
import { KYSELY, type Database, type ExportFilter, type JobStatus } from '../../shared/db';
import { MONTH_RE } from '../../shared/order-report';
import { sendMessage } from './export-queue';

export class InvalidExportRequest extends Error {}
export class UnknownUser extends Error {}

export interface ExportJobRef {
  id: number;
  status: JobStatus;
  /** false khi bấm lại với cùng bộ lọc trong lúc job cũ còn chờ hoặc đang chạy. */
  created: boolean;
}

const ACTIVE: JobStatus[] = ['queued', 'running'];
const filterHash = (filter: ExportFilter) => createHash('sha256').update(JSON.stringify({ month: filter.month })).digest('hex');

@Injectable()
export class CreateExportService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async request(userId: number, filter: ExportFilter): Promise<ExportJobRef> {
    if (!MONTH_RE.test(filter.month ?? '')) throw new InvalidExportRequest('month phải có dạng YYYY-MM');
    const user = await this.db.selectFrom('users').select(['id', 'tenant_id']).where('id', '=', userId).executeTakeFirst();
    if (!user) throw new UnknownUser(`không có người dùng ${userId}`);
    const hash = filterHash(filter);

    // Job cũ có thể vừa xong giữa lúc INSERT bị trùng và lúc đọc lại: thử lại vài lần là đủ.
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await this.db.transaction().execute(async (trx) => {
        // [PATTERN] unique một phần (requested_by, filter_hash) khi queued/running: bấm 5 lần chỉ một job
        const inserted = await trx
          .insertInto('export_jobs')
          .values({ tenant_id: user.tenant_id, requested_by: user.id, filter: JSON.stringify(filter), filter_hash: hash })
          .onConflict((oc) => oc.columns(['requested_by', 'filter_hash']).where('status', 'in', ACTIVE).doNothing())
          .returning(['id', 'status'])
          .executeTakeFirst();
        if (inserted) {
          // [PATTERN] gửi message trong CÙNG transaction với dòng export_jobs: commit thì có cả hai, rollback thì không có gì
          await sendMessage(trx, this.config.exports.queue, { jobId: inserted.id });
          return { ...inserted, created: true };
        }
        const existing = await trx
          .selectFrom('export_jobs')
          .select(['id', 'status'])
          .where('requested_by', '=', user.id)
          .where('filter_hash', '=', hash)
          .where('status', 'in', ACTIVE)
          .executeTakeFirst();
        return existing ? { ...existing, created: false } : undefined;
      });
      if (ref) return ref;
    }
    throw new Error(`không tạo được job xuất cho người dùng ${userId}`);
  }
}
