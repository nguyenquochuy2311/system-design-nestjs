import { Module } from '@nestjs/common';
import { ExportWorkerModule } from './sau/exports/exports.module';
import { SharedModule } from './shared/shared.module';

/** Process type `worker`: cùng SharedModule với web, chỉ thêm ExportWorker. */
@Module({ imports: [SharedModule, ExportWorkerModule] })
export class WorkerModule {}
