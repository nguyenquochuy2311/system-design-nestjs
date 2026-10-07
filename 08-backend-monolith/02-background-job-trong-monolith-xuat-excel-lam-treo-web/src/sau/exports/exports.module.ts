import { Module } from '@nestjs/common';
import { CreateExportService } from './create-export.service';
import { ExportWorker } from './export.worker';
import { ExportsController } from './exports.controller';

/** Phía web: nhận yêu cầu xuất (202 Accepted) và trả trạng thái. */
@Module({ controllers: [ExportsController], providers: [CreateExportService] })
export class ExportsModule {}

/** Phía worker: cùng codebase, cùng hạ tầng dùng chung, không có controller nào. */
@Module({ providers: [ExportWorker] })
export class ExportWorkerModule {}
