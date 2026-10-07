// Phần dùng chung của các script đo: bật/tắt tiến trình web và worker, lấy mẫu RSS bằng `ps`, thống kê.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Proc {
  child: ChildProcess;
  pid: number;
  stop: (signal?: NodeJS.Signals) => Promise<void>;
}

/** Bật `src/main.<kind>.ts` như `pnpm dev:<kind>` nhưng là một tiến trình node duy nhất để tắt và đo RSS chắc chắn. */
export async function startProcess(kind: 'web' | 'worker', env: Record<string, string>, logFile: string): Promise<Proc> {
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', `src/main.${kind}.ts`], { env: { ...process.env, ...env }, stdio: ['ignore', log, log] });
  const stop = async (signal: NodeJS.Signals = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill(signal);
    await exited;
  };
  process.on('exit', () => child.kill('SIGKILL'));
  return { child, pid: child.pid!, stop };
}

export async function waitHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // chưa lên
    }
    if (Date.now() > deadline) throw new Error(`không gọi được ${url}`);
    await sleep(200);
  }
}

export async function waitForLog(read: () => string, text: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!read().includes(text)) {
    if (Date.now() > deadline) throw new Error(`không thấy "${text}" trong log`);
    await sleep(100);
  }
}

/** Lấy mẫu RSS (MB) của các pid mỗi `everyMs` bằng `ps`, ở tiến trình đo: không phụ thuộc event loop của tiến trình bị đo. */
export function sampleRss(pids: Record<string, number>, everyMs = 200) {
  const samples: { t: number; rssMb: Record<string, number> }[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const list = Object.values(pids).join(',');
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'pid=,rss=', '-p', list]);
        const byPid = new Map(stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]));
        const rssMb: Record<string, number> = {};
        for (const [name, pid] of Object.entries(pids)) {
          const kb = byPid.get(pid);
          if (kb !== undefined) rssMb[name] = Number((kb / 1024).toFixed(1));
        }
        samples.push({ t: Date.now(), rssMb });
      } catch {
        // tiến trình đã thoát
      }
      await sleep(everyMs);
    }
  })();
  return {
    samples,
    stop: async () => {
      running = false;
      await loop;
    },
    peak: (name: string, from = 0, to = Infinity) =>
      Math.max(0, ...samples.filter((s) => s.t >= from && s.t <= to && s.rssMb[name] !== undefined).map((s) => s.rssMb[name] as number)),
  };
}

/** Phân vị nội suy tuyến tính giữa hai hạng gần nhất. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (rank - lo);
}

export const median = (xs: number[]) => percentile(xs, 50);
export const round = (x: number, digits = 1) => Number(x.toFixed(digits));
export const summarize = (xs: number[]) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
