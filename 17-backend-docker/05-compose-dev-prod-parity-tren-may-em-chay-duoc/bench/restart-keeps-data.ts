import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDotEnv, requireEnv } from '../src/config';
import { runMigrations } from '../src/db/migrator';
import { LAB, machine, sh } from './lib/run';

// Mục 5, chỉ số "`docker compose up -d` chạy lại không hỏng": ghi một dòng mẫu vào crm, rồi chạy lại `up -d --wait`
// 3 lần, `restart`, `down` (giữ volume) + `up`; sau mỗi lần kiểm dòng mẫu còn, role/quyền giữ nguyên và init script
// không chạy lại (volume đã có dữ liệu). Ghi bench/results/<tên lượt>/restart.json.
loadDotEnv();
const outDir = join(LAB, 'bench/results', process.argv[2] ?? 'main');
mkdirSync(outDir, { recursive: true });

async function state(marker: string) {
  const c = new pg.Client({ connectionString: requireEnv('DATABASE_URL') });
  await c.connect();
  try {
    const row = await c.query('SELECT count(*)::int AS n FROM customers WHERE email = $1', [marker]);
    const priv = await c.query(`SELECT has_schema_privilege('public', 'CREATE') AS create_on_public, current_user AS role`);
    return { markerRows: row.rows[0].n as number, ...(priv.rows[0] as { create_on_public: boolean; role: string }) };
  } finally {
    await c.end();
  }
}
// Log của container hiện tại: số lần init script chạy, và dòng "Skipping initialization" khi volume đã có dữ liệu.
const initRuns = () => sh('docker compose logs postgres 2>&1 | grep -c "running /docker-entrypoint-initdb.d/01-roles.sql"').out.trim();
const skipped = () => sh('docker compose logs postgres 2>&1 | grep -c "Skipping initialization"').out.trim();

const up = sh('docker compose up -d --wait');
if (up.code !== 0) throw new Error(up.out);
const mig = await runMigrations(requireEnv('MIGRATION_DATABASE_URL'));
if (mig.error) throw new Error(mig.error.message);
const marker = `mau-${Date.now()}@vi-du.test`;
const c = new pg.Client({ connectionString: requireEnv('DATABASE_URL') });
await c.connect();
await c.query('INSERT INTO customers (name, email) VALUES ($1, $2)', ['Dòng mẫu', marker]);
await c.end();

const steps: { action: string; ms: number; code: number | null; initScriptRunsInLog: string; skippingInitInLog: string; state: Awaited<ReturnType<typeof state>> }[] = [];
for (const [action, cmd] of [
  ['up -d --wait (lần 1)', 'docker compose up -d --wait'],
  ['up -d --wait (lần 2)', 'docker compose up -d --wait'],
  ['up -d --wait (lần 3)', 'docker compose up -d --wait'],
  ['restart + up --wait', 'docker compose restart && docker compose up -d --wait'],
  ['down (giữ volume) + up --wait', 'docker compose down && docker compose up -d --wait'],
] as const) {
  const r = sh(cmd);
  steps.push({ action, ms: r.ms, code: r.code, initScriptRunsInLog: initRuns(), skippingInitInLog: skipped(), state: await state(marker) });
  console.log(`${action.padEnd(32)} ${(r.ms / 1000).toFixed(1)} s · mã ${r.code} · dòng mẫu ${steps.at(-1)!.state.markerRows} · CREATE(public) app=${steps.at(-1)!.state.create_on_public} · init trong log: ${steps.at(-1)!.initScriptRunsInLog}, bỏ qua init: ${steps.at(-1)!.skippingInitInLog}`);
}
writeFileSync(join(outDir, 'restart.json'), JSON.stringify({ machine: machine(), marker, steps }, null, 2));
