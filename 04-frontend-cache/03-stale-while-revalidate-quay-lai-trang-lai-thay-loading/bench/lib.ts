// Phần dùng chung của các script đo: thư mục kết quả, môi trường đo, bộ phát hiện máy ngủ, mẫu tải của máy.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { LAB_DIR } from '../test/support/lab';

export function resultsDir(): string {
  const dir = join(LAB_DIR, 'bench/results', process.env.RUN ?? 'main');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`→ ${file}`);
}

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

/** Nguồn điện và trạng thái nắp lúc bắt đầu lượt (máy gập nắp chạy pin thì ngủ từng đợt: nhật ký quyết định bài 04/02). */
export function powerState(): Record<string, unknown> {
  return {
    battery: sh('pmset', ['-g', 'batt']).split('\n')[0] ?? '',
    clamshell: /AppleClamshellState"\s*=\s*(\w+)/.exec(sh('ioreg', ['-r', '-k', 'AppleClamshellState', '-d', '4']))?.[1] ?? 'không rõ',
    caffeinate: sh('pgrep', ['-fl', 'caffeinate']) || null,
  };
}

const pkg = (name: string) => (JSON.parse(readFileSync(join(LAB_DIR, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;

export function environment(chromeVersion: string | null): Record<string, unknown> {
  return {
    node: process.version,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    memGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    os: sh('sw_vers', ['-productVersion']),
    chrome: chromeVersion,
    next: pkg('next'),
    react: pkg('react'),
    tanstackQuery: pkg('@tanstack/react-query'),
    nest: pkg('@nestjs/core'),
    playwright: pkg('playwright-core'),
    hostLoad: loadavg(),
    power: powerState(),
  };
}

export interface SleepGap {
  from: number;
  to: number;
  seconds: number;
}

/**
 * Phát hiện máy ngủ trong lúc đo (mẫu bài 04/02): nhịp 1 giây; hai nhịp cách nhau quá 2,5 giây nghĩa là cả máy vừa
 * ngủ hoặc tiến trình bị treo. Lượt có khoảng ngủ là lượt bẩn, phải chạy lại dưới tên khác.
 */
export function startSleepDetector(): { stop: () => SleepGap[]; gaps: SleepGap[] } {
  const gaps: SleepGap[] = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const t = Date.now();
    if (t - last > 2_500) gaps.push({ from: last, to: t, seconds: Number(((t - last) / 1000).toFixed(1)) });
    last = t;
  }, 1_000);
  return {
    gaps,
    stop: () => {
      clearInterval(timer);
      return gaps;
    },
  };
}

export interface LoadSample {
  t: number;
  load1: number;
  /** 'AC Power' hoặc 'Battery Power' (dòng đầu của pmset -g batt). */
  power: string;
  batteryPct: number | null;
}

function powerNow(): { power: string; batteryPct: number | null } {
  const out = sh('pmset', ['-g', 'batt']);
  return { power: /'([^']+)'/.exec(out)?.[1] ?? 'không rõ', batteryPct: Number(/(\d+)%/.exec(out)?.[1] ?? NaN) || null };
}

/**
 * Load 1 phút của macOS và nguồn điện mỗi intervalMs (lab không có container: không có số của máy ảo Docker). Lượt mà
 * nguồn điện đổi giữa chừng (cắm/rút sạc) không dùng để so hai bản: powerChanged = true.
 */
export function startLoadSampler(intervalMs = 10_000): { stop: () => { samples: LoadSample[]; powerSources: string[]; powerChanged: boolean } } {
  const samples: LoadSample[] = [];
  const tick = () => samples.push({ t: Date.now(), load1: Number(loadavg()[0]!.toFixed(2)), ...powerNow() });
  tick();
  const timer = setInterval(tick, intervalMs);
  return {
    stop: () => {
      clearInterval(timer);
      tick();
      const powerSources = [...new Set(samples.map((x) => x.power))];
      return { samples, powerSources, powerChanged: powerSources.length > 1 };
    },
  };
}

export const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Phân vị theo cách "nearest rank" (p trong 0..100), đủ cho vài trăm mẫu. */
export const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
};

export const round = (x: number, d = 1) => Number(x.toFixed(d));

/** PRNG có hạt (mulberry32): mọi bản nhận cùng một chuỗi lựa chọn của từng điều phối viên. */
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
