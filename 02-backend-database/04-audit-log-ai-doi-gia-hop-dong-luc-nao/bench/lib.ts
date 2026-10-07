import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { ADMIN_URL, LAB_DIR } from '../src/shared/config';
import '../src/shared/db'; // đăng ký bộ đổi kiểu int8 -> number cho pg

const run = promisify(execFile);

/** Thư mục ghi số đo thô (không commit). Đổi bằng RESULTS_DIR=bench/results/main ... */
export const RESULTS_DIR = join(LAB_DIR, process.env.RESULTS_DIR ?? 'bench/results');
mkdirSync(RESULTS_DIR, { recursive: true });

export function save(name: string, data: unknown): string {
  const file = join(RESULTS_DIR, name);
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return file;
}

export async function adminClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: ADMIN_URL, application_name: 'bench-admin' });
  await c.connect();
  return c;
}

/** Bật / tắt trigger nhật ký trên public.contracts, hoặc đổi chế độ lưu ('full' | 'diff'). Cần chủ bảng / superuser. */
export async function setAuditTrigger(admin: pg.Client, state: 'on' | 'off' | 'full' | 'diff'): Promise<void> {
  if (state === 'on' || state === 'off') {
    await admin.query(`ALTER TABLE public.contracts ${state === 'on' ? 'ENABLE' : 'DISABLE'} TRIGGER contracts_audit`);
    return;
  }
  await admin.query(
    `CREATE OR REPLACE TRIGGER contracts_audit AFTER INSERT OR UPDATE OR DELETE ON public.contracts
     FOR EACH ROW EXECUTE FUNCTION audit.log_change('${state}')`,
  );
}

/** Xóa sạch nhật ký để đo lại từ đầu: chỉ superuser làm được, và phải tắt trigger chặn TRUNCATE trước. */
export async function resetAuditLog(admin: pg.Client): Promise<void> {
  await admin.query('ALTER TABLE audit.audit_log DISABLE TRIGGER audit_log_append_only');
  try {
    await admin.query('TRUNCATE audit.audit_log RESTART IDENTITY');
  } finally {
    await admin.query('ALTER TABLE audit.audit_log ENABLE TRIGGER audit_log_append_only');
  }
}

/** Load average và bộ đếm CPU của máy ảo Docker, đọc trong container postgres (cùng kernel với mọi container). */
export async function vmStats(): Promise<{ loadavg: number[]; cpu: { busy: number; total: number } }> {
  const { stdout } = await run('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'cat /proc/loadavg; head -1 /proc/stat'], { cwd: LAB_DIR });
  const [load, stat] = stdout.trim().split('\n');
  const f = stat!.trim().split(/\s+/).slice(1).map(Number); // user nice system idle iowait irq softirq steal
  const idle = f[3]! + f[4]!;
  const total = f.reduce((a, b) => a + b, 0);
  return { loadavg: load!.split(' ').slice(0, 3).map(Number), cpu: { busy: total - idle, total } };
}

export function cpuBusyPercent(a: { cpu: { busy: number; total: number } }, b: { cpu: { busy: number; total: number } }): number {
  return (100 * (b.cpu.busy - a.cpu.busy)) / (b.cpu.total - a.cpu.total);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
