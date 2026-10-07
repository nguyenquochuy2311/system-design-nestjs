import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExportWorker } from './sau/exports/export.worker';
import { WorkerModule } from './worker.module';

// [PATTERN] process type `worker`: cùng codebase và cùng image với web, chỉ khác lệnh khởi động (Twelve-Factor).
const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'error', 'warn'] });
const worker = app.get(ExportWorker);
worker.start();
console.log(`worker sẵn sàng (pid ${process.pid})`);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`worker nhận ${signal}: không nhận job mới, chờ job đang chạy xong`);
  await worker.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
