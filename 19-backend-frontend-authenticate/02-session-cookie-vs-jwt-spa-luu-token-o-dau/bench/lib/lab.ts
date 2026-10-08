// Tiện ích dùng chung cho bench: cổng, build Next (cache theo hash mã nguồn), bật API (NestJS) và Next như tiến
// trình riêng, mở Google Chrome hệ thống (headless, profile tạm — KHÔNG đụng Chrome của người dùng), ghi kết quả.
import { spawn, spawnSync, execSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

export const LAB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const API_PORT = 3100;
export const WEB_PORT = 3200;
export const API = `http://127.0.0.1:${API_PORT}`;
export const WEB = `http://localhost:${WEB_PORT}`;
export const ORIGIN = WEB;

export const RUN = process.env.RUN ?? 'trial';
export const RESULTS_DIR = resolve(LAB_DIR, 'bench/results', RUN);

/** Secret tạm cho tiến trình API của bench (không phải secret thật, chỉ sống trong lượt đo). */
export function benchSecrets(): Record<string, string> {
  const rnd = () => createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('base64');
  return { SESSION_SECRET: rnd(), CSRF_SECRET: rnd(), JWT_SECRET: rnd() };
}

// ---------- build Next ----------
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next') || name === 'next-env.d.ts') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else out.push(p);
  }
  return out.sort();
}
export function webSourceHash(): string {
  const h = createHash('sha256').update('v1');
  for (const f of sourceFiles(join(LAB_DIR, 'web'))) h.update(relative(LAB_DIR, f)).update(readFileSync(f));
  return h.digest('hex').slice(0, 16);
}
/** `next build web` nếu bản build hiện có không khớp mã nguồn. Ép NODE_ENV=production (nhật ký 04/02 điểm 2). */
export function ensureWebBuild(): { hash: string; built: boolean; seconds: number } {
  const hash = webSourceHash();
  const marker = join(LAB_DIR, 'web/.next/lab-source-hash');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === hash) return { hash, built: false, seconds: 0 };
  const started = Date.now();
  const res = spawnSync(process.execPath, [join(LAB_DIR, 'node_modules/next/dist/bin/next'), 'build', 'web'], {
    cwd: LAB_DIR,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`next build thất bại (mã ${res.status}):\n${res.stdout}\n${res.stderr}`);
  writeFileSync(marker, hash);
  return { hash, built: true, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
}

// ---------- tiến trình ----------
export interface Proc {
  child: ChildProcess;
  stop: () => Promise<void>;
}
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((res, rej) => {
    const srv = createServer();
    srv.once('error', () => rej(new Error(`cổng ${port} đang bận: lsof -nP -iTCP:${port} -sTCP:LISTEN`)));
    srv.listen(port, '127.0.0.1', () => srv.close(() => res()));
  });
}
async function waitHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* chưa lên */
    }
    if (Date.now() > deadline) throw new Error(`không gọi được ${url}`);
    await sleep(150);
  }
}
async function startProcess(args: string[], port: number, healthUrl: string, env: Record<string, string>): Promise<Proc> {
  await assertPortFree(port);
  const child = spawn(process.execPath, args, {
    cwd: LAB_DIR,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const kill = () => child.kill('SIGKILL');
  process.once('exit', kill);
  const stop = async () => {
    process.off('exit', kill);
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(5_000).then(() => child.kill('SIGKILL'))]);
  };
  try {
    await waitHttp(healthUrl);
  } catch (e) {
    await stop();
    throw e;
  }
  return { child, stop };
}
export const startApi = (env: Record<string, string> = {}) =>
  startProcess(['--import', 'tsx', 'src/main.ts'], API_PORT, `${API}/_attacker/loot`, {
    PORT: String(API_PORT),
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/crm',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:56379',
    ALLOWED_ORIGINS: `${WEB},http://127.0.0.1:${WEB_PORT}`,
    TRUST_LOCALHOST_SECURE: '1',
    ...env,
  });
export const startWeb = () =>
  startProcess(
    [join(LAB_DIR, 'node_modules/next/dist/bin/next'), 'start', 'web', '--port', String(WEB_PORT), '--hostname', '127.0.0.1'],
    WEB_PORT,
    `${WEB}/healthz`,
    { NODE_ENV: 'production' },
  );

// ---------- trình duyệt ----------
export const launchChrome = (): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: true });

// ---------- tiện ích đo ----------
const sh = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
export function machineState() {
  const batt = sh('pmset -g batt');
  return {
    at: new Date().toISOString(),
    power: /AC Power/.test(batt) ? 'sạc' : /Battery Power/.test(batt) ? 'pin' : 'không rõ',
    battery: batt.match(/(\d+)%/)?.[1] ? Number(batt.match(/(\d+)%/)![1]) : null,
    lidClosed: /Yes/.test(sh('ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState')),
    load1: Number(sh('sysctl -n vm.loadavg').replace(/[{}]/g, '').trim().split(/\s+/)[0] ?? NaN),
  };
}
export function writeResult(name: string, data: unknown): string {
  const file = resolve(RESULTS_DIR, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
export const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
/** k6 chạy bằng spawn bất đồng bộ (nhật ký 01/02 điểm 4). */
export function k6(args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    const child = spawn('k6', args, { cwd: LAB_DIR, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.once('exit', (status) => done({ status, stdout }));
  });
}
export { sleep };
