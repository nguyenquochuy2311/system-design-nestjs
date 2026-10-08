// Chạy job dọn khóa một lần (cron bên ngoài gọi lệnh này): pnpm job:cleanup
import 'reflect-metadata';
import { createDb } from '../../shared/db';
import { CleanupExpiredKeysJob } from './cleanup-expired-keys.job';
import { IdempotencyRepository } from './idempotency.repository';
import { optionsFromEnv } from './idempotency.options';

const db = createDb({ max: 1 });
const options = optionsFromEnv();
try {
  const deleted = await new CleanupExpiredKeysJob(new IdempotencyRepository(db), options).run();
  console.log(`Đã xóa ${deleted} khóa tạo trước ${options.retentionHours} giờ`);
} finally {
  await db.destroy();
}
