import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../shared/config';
import { KYSELY, type Database } from '../../shared/db';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/object-storage';
import { reportFilename } from '../../shared/order-report';
import { CreateExportService, InvalidExportRequest, UnknownUser } from './create-export.service';

const parseUser = (raw: string | undefined): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('thiếu header x-user-id');
  return id;
};

/** Asynchronous Request-Reply: POST nhận yêu cầu và trả 202 ngay; GET trạng thái tới khi có URL tải. */
@Controller('exports')
export class ExportsController {
  constructor(
    @Inject(CreateExportService) private readonly createExport: CreateExportService,
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // [PATTERN] 202 Accepted + Location: không làm việc nặng nào trong request
  @Post()
  @HttpCode(202)
  async create(@Headers('x-user-id') userHeader: string | undefined, @Body() body: { month?: string }, @Res({ passthrough: true }) res: Response) {
    const userId = parseUser(userHeader);
    try {
      const job = await this.createExport.request(userId, { month: String(body?.month ?? '') });
      res.setHeader('Location', `/exports/${job.id}`);
      return { id: job.id, status: job.status, created: job.created, statusUrl: `/exports/${job.id}` };
    } catch (err) {
      if (err instanceof InvalidExportRequest) throw new BadRequestException(err.message);
      if (err instanceof UnknownUser) throw new NotFoundException(err.message);
      throw err;
    }
  }

  @Get(':id')
  async status(@Headers('x-user-id') userHeader: string | undefined, @Param('id', ParseIntPipe) id: number, @Res({ passthrough: true }) res: Response) {
    const userId = parseUser(userHeader);
    const job = await this.db
      .selectFrom('export_jobs')
      .select(['id', 'status', 'filter', 'attempts', 'rows_written', 'row_count', 'object_key', 'last_error', 'created_at', 'finished_at'])
      .where('id', '=', id)
      .where('requested_by', '=', userId) // chỉ người yêu cầu mới thấy job của mình
      .executeTakeFirst();
    if (!job) throw new NotFoundException(`không có job ${id}`);
    const base = { id: job.id, status: job.status, attempts: job.attempts, rowsWritten: job.rows_written, createdAt: job.created_at };
    if (job.status === 'done' && job.object_key) {
      const ttl = this.config.exports.downloadTtlSeconds;
      const downloadUrl = await this.storage.presignDownload(job.object_key, reportFilename(job.filter.month), ttl);
      return { ...base, rowCount: job.row_count, finishedAt: job.finished_at, downloadUrl, expiresInSeconds: ttl };
    }
    if (job.status === 'failed') return { ...base, error: job.last_error, finishedAt: job.finished_at };
    res.setHeader('Retry-After', '2'); // gợi ý client hỏi lại sau 2 giây
    return { ...base, lastError: job.last_error };
  }
}
