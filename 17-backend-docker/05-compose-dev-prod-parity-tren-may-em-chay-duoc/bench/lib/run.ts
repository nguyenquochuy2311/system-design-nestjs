import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

export const LAB = resolve(import.meta.dirname, '../..');
export const PG14_IMAGE = 'postgres:14.24@sha256:14bfab572eec6abf65892e1db7c3ba8d41b2a2855c1b143664907d6e146eb6e1';
export const PG16_IMAGE = 'postgres:16.15@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d';

// Node đang chạy bench lên đầu PATH để pnpm/tsx/vitest con dùng đúng bản này (như scripts/kiem-chung-lab.mjs).
const PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`;

export interface ShResult {
  code: number | null;
  out: string;
  ms: number;
}

/** Chạy một lệnh shell, ghi đủ stdout+stderr và mã thoát của chính lệnh (không qua `| tail`, nhật ký 2026-10-09). */
export function sh(cmd: string, opts: { cwd?: string; env?: Record<string, string | undefined> } = {}): ShResult {
  const t = performance.now();
  const r = spawnSync('/bin/zsh', ['-c', cmd], {
    cwd: opts.cwd ?? LAB,
    env: { ...process.env, PATH, ...opts.env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: performance.now() - t };
}

/** Điều kiện máy trước mỗi lượt đo (quy-trinh-lab mục 1 điểm 5): nguồn điện, nắp, load. */
export function machine(): { at: string; power: string; battery: string; lidClosed: boolean; load: string } {
  const batt = sh('pmset -g batt').out.trim().split('\n');
  return {
    at: new Date().toISOString(),
    power: (batt[0] ?? '').replace("Now drawing from ", ''),
    battery: (batt[1] ?? '').trim(),
    lidClosed: /Yes/.test(sh('ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState').out),
    load: sh('sysctl -n vm.loadavg').out.trim(),
  };
}

export function environment(): Record<string, string> {
  return {
    docker: sh("docker version --format 'server {{.Server.Version}} / client {{.Client.Version}}'").out.trim(),
    dockerDesktop: sh("docker info --format '{{.OperatingSystem}} · {{.NCPU}} CPU · {{.MemTotal}} B'").out.trim(),
    node: process.version,
    pnpm: sh('pnpm -v').out.trim(),
    macos: sh('sw_vers -productVersion').out.trim(),
    cpu: sh('sysctl -n machdep.cpu.brand_string').out.trim(),
  };
}

export const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Bản sao "vừa git clone" của thư mục bài: chỉ file git theo dõi hoặc chưa theo dõi mà không bị .gitignore loại
 * (không node_modules, .env, bench/results, .tmp). Bài chưa commit nên phải lấy cả file chưa theo dõi.
 */
export function cleanCopy(dest: string): number {
  rmSync(dest, { recursive: true, force: true });
  const files = sh('git ls-files -co --exclude-standard -z .').out.split('\0').filter(Boolean);
  for (const f of files) {
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    cpSync(join(LAB, f), join(dest, f));
  }
  return files.length;
}

export function parseEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m?.[1]) env[m[1]] = m[2] ?? '';
  }
  return env;
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? NaN) + (s[m] ?? NaN)) / 2;
};
