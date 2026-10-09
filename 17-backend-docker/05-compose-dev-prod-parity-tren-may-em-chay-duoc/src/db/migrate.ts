import { loadDotEnv, requireEnv } from '../config';
import { runMigrations } from './migrator';

// `pnpm db:migrate`: chạy mọi migration còn thiếu bằng role owner. Thoát mã 1 khi lỗi để CI dừng ở đúng bước này.
loadDotEnv();
const run = await runMigrations(requireEnv('MIGRATION_DATABASE_URL'));
console.log(`migration: role=${run.currentUser} server=${run.serverVersion} (${run.ms.toFixed(0)} ms)`);
for (const r of run.results) console.log(`  ${String(r.status).padEnd(11)} ${r.migrationName}`);
if (run.error) {
  console.error(`LỖI migration [${run.error.code ?? '-'}]: ${run.error.message}`);
  process.exit(1);
}
