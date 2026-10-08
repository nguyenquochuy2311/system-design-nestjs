import { exec, execSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { LAB_DIR } from './env.js';

/** Chạy API (src/main.ts) thành tiến trình riêng, tách khỏi client đo (nhật ký 08/02 điểm 1). */
export async function startApi(port = 3100, env: Record<string, string> = {}): Promise<{ proc: ChildProcess; cpuSeconds: () => number; stop: () => Promise<void> }> {
  // Cổng đã có tiến trình khác (ví dụ `pnpm dev` quên tắt) thì dừng, để không đo nhầm (nhật ký 01/02 điểm 4).
  const busy = await fetch(`http://127.0.0.1:${port}/healthz`).then(() => true, () => false);
  if (busy) throw new Error(`Cổng ${port} đang có tiến trình khác nghe; tắt nó trước khi đo.`);
  const proc = spawn(resolve(LAB_DIR, 'node_modules/.bin/tsx'), ['src/main.ts'], {
    cwd: LAB_DIR,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let exited = false;
  proc.once('exit', () => (exited = true));
  for (let i = 0; i < 150 && !exited; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
    } catch {
      /* chưa nghe cổng */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (exited) throw new Error('API thoát ngay khi khởi động');
  // tsx chạy server trong một tiến trình node con: cộng CPU của cả cây tiến trình.
  const cpuSeconds = () => {
    const out = execSync(`ps -o pid=,ppid=,time= -A`, { encoding: 'utf8' });
    const rows = out.trim().split('\n').map((l) => l.trim().split(/\s+/)) as [string, string, string][];
    const tree = new Set([String(proc.pid)]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [pid, ppid] of rows) if (tree.has(ppid) && !tree.has(pid)) (tree.add(pid), (changed = true));
    }
    return rows.filter(([pid]) => tree.has(pid)).reduce((sum, [, , t]) => sum + toSeconds(t), 0);
  };
  const stop = () =>
    new Promise<void>((done) => {
      proc.once('exit', () => done());
      proc.kill('SIGTERM');
    });
  return { proc, cpuSeconds, stop };
}

function toSeconds(t: string): number {
  // định dạng của ps trên macOS: [[dd-]hh:]mm:ss.cc
  const [d, rest] = t.includes('-') ? (t.split('-') as [string, string]) : ['0', t];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(d) * 86400 + parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

const execAsync = promisify(exec);

/** Lệnh shell không chặn event loop (để bộ phát hiện máy ngủ không báo nhầm). */
export async function run(cmd: string): Promise<string> {
  const { stdout } = await execAsync(cmd, { cwd: LAB_DIR, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** k6 chạy bằng spawn bất đồng bộ: spawnSync chặn event loop và bộ phát hiện máy ngủ sẽ báo nhầm (nhật ký 01/02 điểm 4). */
export function k6(args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    const child = spawn('k6', args, { cwd: LAB_DIR, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.once('exit', (status) => done({ status, stdout }));
  });
}

/** Thông tin phiên bản cho mục 5.1. */
export async function versions() {
  const pgVersion = (await run(`docker compose exec -T postgres psql -U app -d accounts -tAc "SHOW server_version"`)).trim();
  const redis = (await run(`docker compose exec -T redis redis-cli INFO server`)).match(/redis_version:(\S+)/)?.[1] ?? 'không rõ';
  const k6v = (await run('k6 version')).trim().split('\n')[0];
  return { node: process.version, postgres: pgVersion, redis, k6: k6v };
}
