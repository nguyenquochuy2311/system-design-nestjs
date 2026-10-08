// Phần dùng chung của các script đo: thư mục kết quả, môi trường đo, đọc log của CDN và API, lấy mẫu tải của máy.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { LAB_DIR } from '../scripts/build-release';
import { compose } from '../scripts/cdn';

const execFileAsync = promisify(execFile);
export const run = async (cmd: string, args: string[]) => (await execFileAsync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout;

export const CDN_LOG = join(LAB_DIR, '.data/logs/cdn.log');

export function resultsDir(): string {
  const dir = join(LAB_DIR, 'bench/results', process.env.RUN ?? 'main');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`→ ${file}`);
}

export const readJsonLines = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T)
    : [];

export interface CdnLine {
  ts: number;
  host: string;
  m: string;
  u: string;
  s: number;
  cache: string;
  us: string;
  bytes: number;
  inm: string;
  ims: string;
  cc: string;
  uid: string;
}

/** Dòng log CDN của một site trong khoảng thời gian (ts tính bằng giây, có phần thập phân). Nginx ghi có đệm 1 s. */
export async function cdnLinesSince(host: string, sinceMs: number): Promise<CdnLine[]> {
  await sleep(2_500);
  return readJsonLines<CdnLine>(CDN_LOG).filter((l) => l.host === host && l.ts * 1000 >= sinceMs);
}

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
      const out = await compose('exec', '-T', 'cdn', 'sh', '-c', 'head -1 /proc/stat; cat /proc/loadavg');
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

export async function environment(chromeVersion?: string): Promise<Record<string, unknown>> {
  const nginx = await compose('exec', '-T', 'cdn', 'sh', '-c', 'nginx -v 2>&1').catch(() => '');
  const pkg = (name: string) => (JSON.parse(readFileSync(join(LAB_DIR, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
  return {
    node: process.version,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    docker: (await run('docker', ['version', '--format', '{{.Server.Version}}'])).trim(),
    dockerCpus: (await run('docker', ['info', '--format', '{{.NCPU}}'])).trim(),
    dockerMemBytes: Number((await run('docker', ['info', '--format', '{{.MemTotal}}'])).trim()),
    nginx: nginx.trim(),
    chrome: chromeVersion ?? null,
    vite: pkg('vite'),
    react: pkg('react'),
    playwright: pkg('playwright-core'),
    hostLoad: loadavg(),
  };
}

export const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** PRNG có hạt (mulberry32): hai bản nhận cùng một chuỗi thao tác của từng người dùng. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Phát hiện máy ngủ trong lúc đo: một bộ đếm 1 giây; hai nhịp cách nhau quá 2,5 giây nghĩa là cả máy vừa ngủ (laptop
 * gập nắp chạy pin ngủ rồi DarkWake từng đợt — gặp thật ở bài 04/02). Đồng hồ hrtime của Node trên macOS cũng chạy
 * trong lúc ngủ (đã kiểm), nên không dùng được để trừ thời gian ngủ; lượt có khoảng ngủ thì coi là lượt bẩn.
 */
export function startSleepDetector(): { stop: () => { from: number; to: number; seconds: number }[] } {
  const gaps: { from: number; to: number; seconds: number }[] = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const t = Date.now();
    if (t - last > 2_500) gaps.push({ from: last, to: t, seconds: Number(((t - last) / 1000).toFixed(1)) });
    last = t;
  }, 1_000);
  return {
    stop: () => {
      clearInterval(timer);
      return gaps;
    },
  };
}
