// Phần dùng chung của các script đo: thư mục kết quả, bật/tắt máy gốc theo bản, làm trống CDN, đọc tải của máy.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { CacheMode } from '../src/shared/config';
import { CDN, startApi, startWeb, waitHttp, type Proc } from '../test/support/lab';

const execFileAsync = promisify(execFile);
export const run = async (cmd: string, args: string[]) => (await execFileAsync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout;

export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const CDN_LOG = '.data/cdn-logs/access.log';

export function resultsDir(): string {
  const dir = join('bench/results', process.env.RUN ?? 'main');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`→ ${file}`);
}

export interface Origins {
  api: Proc;
  web: Proc;
  apiLog: string | null;
  webLog: string | null;
  stop: () => Promise<void>;
}

/** Bật API (3100) và trang (3200) của một bản như hai tiến trình riêng; accessLogPrefix = ghi log truy cập của máy gốc. */
export async function startOrigins(mode: CacheMode, dir: string, name: string, accessLog: boolean): Promise<Origins> {
  const apiLog = accessLog ? join(dir, `${name}-origin-api.log`) : null;
  const webLog = accessLog ? join(dir, `${name}-origin-web.log`) : null;
  for (const f of [apiLog, webLog]) if (f) writeFileSync(f, '');
  const out = openSync(join(dir, `${name}-origins.out`), 'a');
  const api = await startApi(mode, undefined, apiLog ? { ACCESS_LOG: apiLog } : {}, out);
  const web = await startWeb(mode, undefined, webLog ? { ACCESS_LOG: webLog } : {}, out);
  return {
    api,
    web,
    apiLog,
    webLog,
    stop: async () => {
      await api.stop();
      await web.stop();
    },
  };
}

/** Làm trống CDN: xóa log rồi khởi động lại container (cache nằm trên tmpfs nên mất theo). */
export async function resetCdn(): Promise<void> {
  if (existsSync(CDN_LOG)) truncateSync(CDN_LOG, 0);
  await run('docker', ['compose', 'restart', 'cdn']);
  await waitHttp(`${CDN}/__cdn/health`, 30_000);
  if (existsSync(CDN_LOG)) truncateSync(CDN_LOG, 0);
}

/** Nginx ghi log có đệm (flush=1s): chờ rồi chép log của lượt sang thư mục kết quả. */
export async function collectCdnLog(dest: string): Promise<void> {
  await sleep(2_500);
  copyFileSync(CDN_LOG, dest);
}

export const readJsonLines = <T>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);

export interface LoadSample {
  t: number;
  hostLoad1: number;
  dockerLoad1: number;
  dockerBusyPct: number | null;
}

/** Load 1 phút của macOS và của máy ảo Docker, % CPU bận của máy ảo Docker từ /proc/stat (nhật ký quyết định bài 02/03). */
export function startLoadSampler(intervalMs = 10_000): { stop: () => Promise<LoadSample[]> } {
  const samples: LoadSample[] = [];
  let prev: { idle: number; total: number } | null = null;
  let stopped = false;
  const tick = async () => {
    try {
      const out = await run('docker', ['compose', 'exec', '-T', 'cdn', 'sh', '-c', 'head -1 /proc/stat; cat /proc/loadavg']);
      const [statLine = '', loadLine = ''] = out.trim().split('\n');
      const n = statLine.trim().split(/\s+/).slice(1).map(Number);
      const cur = { idle: (n[3] ?? 0) + (n[4] ?? 0), total: n.reduce((a, b) => a + b, 0) };
      const busy = prev && cur.total > prev.total ? 100 * (1 - (cur.idle - prev.idle) / (cur.total - prev.total)) : null;
      prev = cur;
      samples.push({ t: Date.now(), hostLoad1: Number(loadavg()[0]!.toFixed(2)), dockerLoad1: Number(loadLine.split(' ')[0]), dockerBusyPct: busy === null ? null : Number(busy.toFixed(1)) });
    } catch (e) {
      console.warn('không lấy được mẫu tải:', (e as Error).message);
    }
  };
  const loop = (async () => {
    while (!stopped) {
      await tick();
      await sleep(intervalMs);
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      await loop;
      await tick();
      return samples;
    },
  };
}

/** Thời gian CPU (giây) đã dùng của một tiến trình trên host, đọc bằng ps ([phút:]giây.phần). */
export async function processCpuSeconds(pid: number): Promise<number | null> {
  try {
    const out = (await run('ps', ['-o', 'time=', '-p', String(pid)])).trim();
    return out.split(':').map(Number).reduce((acc, p) => acc * 60 + p, 0);
  } catch {
    return null;
  }
}

export async function environment(): Promise<Record<string, unknown>> {
  const nginx = await run('docker', ['compose', 'exec', '-T', 'cdn', 'sh', '-c', 'nginx -v 2>&1']).catch(() => '');
  return {
    node: process.version,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    docker: (await run('docker', ['version', '--format', '{{.Server.Version}}'])).trim(),
    dockerCpus: (await run('docker', ['info', '--format', '{{.NCPU}}'])).trim(),
    dockerMemBytes: Number((await run('docker', ['info', '--format', '{{.MemTotal}}'])).trim()),
    nginx: nginx.trim(),
    k6: (await run('k6', ['version']).catch(() => '')).trim(),
    hostLoad: loadavg(),
  };
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
