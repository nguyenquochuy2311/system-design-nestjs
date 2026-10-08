import { exec, execSync, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { LAB_DIR } from './env.js';

/** Chạy API (src/server.ts) thành tiến trình riêng, tách khỏi client đo (nhật ký 08/02 điểm 1). */
export async function startApi(port = 3100): Promise<{ proc: ChildProcess; cpuSeconds: () => number; stop: () => Promise<void> }> {
  // Cổng đã có API khác (ví dụ `pnpm dev` quên tắt) thì dừng: nếu không, script sẽ đo nhầm tiến trình kia.
  const busy = await fetch(`http://127.0.0.1:${port}/healthz`).then(() => true, () => false);
  if (busy) throw new Error(`Cổng ${port} đang có tiến trình khác nghe; tắt nó trước khi đo.`);
  const proc = spawn(resolve(LAB_DIR, 'node_modules/.bin/tsx'), ['src/server.ts'], {
    cwd: LAB_DIR,
    env: { ...process.env, PORT: String(port), CURSOR_SECRET: randomBytes(32).toString('base64url') },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let exited = false;
  proc.once('exit', () => (exited = true));
  for (let i = 0; i < 100 && !exited; i++) {
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

/** CPU đã dùng của container PostgreSQL (usage_usec trong cgroup, nhật ký 03/01 điểm 4). */
export async function postgresCpuSeconds(): Promise<number> {
  const out = await run('docker compose exec -T postgres cat /sys/fs/cgroup/cpu.stat');
  return Number(out.match(/usage_usec (\d+)/)?.[1] ?? NaN) / 1e6;
}
