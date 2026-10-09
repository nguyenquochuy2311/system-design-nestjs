// Chạy lệnh ngoài KHÔNG chặn event loop (nhật ký 01/02 điểm 4: spawnSync làm bộ phát hiện máy ngủ báo sai).
import { spawn } from 'node:child_process';
import { loadavg } from 'node:os';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: string[], opts: { env?: Record<string, string>; quiet?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function mustRun(cmd: string, args: string[], opts: { env?: Record<string, string> } = {}): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} → mã ${r.code}\n${r.stderr.slice(-2000)}`);
  return r;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nguồn điện, nắp gập, load của macOS — ghi kèm mỗi lượt đo (quy-trinh-lab mục 1 điểm 5, nhật ký 04/03 điểm 6). */
export async function machineState() {
  const batt = (await run('pmset', ['-g', 'batt'])).stdout.split('\n')[0]?.trim() ?? '';
  const lid = (await run('/bin/sh', ['-c', 'ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState'])).stdout.trim();
  return { at: new Date().toISOString(), power: batt, lidClosed: /Yes/.test(lid), load: loadavg().map((x) => Number(x.toFixed(2))) };
}

/** Phát hiện máy ngủ: hai nhịp 1 s cách nhau quá 2,5 s (nhật ký 04/02 điểm 5). */
export function startSleepDetector() {
  const gaps: { at: string; gapMs: number }[] = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - last > 2500) gaps.push({ at: new Date(now).toISOString(), gapMs: now - last });
    last = now;
  }, 1000);
  return { stop: () => (clearInterval(timer), gaps) };
}

/** CPU % (100 = một nhân) và RAM của container lab qua `docker stats --no-stream`. */
export async function dockerStats(): Promise<Record<string, { cpu: number; memMiB: number }>> {
  const r = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
  const out: Record<string, { cpu: number; memMiB: number }> = {};
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const s = JSON.parse(line) as { Name: string; CPUPerc: string; MemUsage: string };
    if (!s.Name.startsWith('lab-23-02-')) continue;
    const mem = s.MemUsage.split('/')[0]!.trim();
    const n = parseFloat(mem);
    const memMiB = mem.endsWith('GiB') ? n * 1024 : mem.endsWith('KiB') ? n / 1024 : mem.endsWith('kB') ? n / 1000 : n;
    out[s.Name.replace(/^lab-23-02-/, '').replace(/-\d+$/, '')] = { cpu: parseFloat(s.CPUPerc), memMiB: Number(memMiB.toFixed(1)) };
  }
  return out;
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
