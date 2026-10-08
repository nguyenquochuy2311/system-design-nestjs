/** Tiện ích cho script đo: thư mục kết quả, môi trường máy, bộ phát hiện máy ngủ, registry trống, trung vị. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { LAB_DIR, run } from '../scripts/lib/docker.js';

export const RUN = process.env.RUN ?? 'main';
export const OUT = join(LAB_DIR, 'bench/results', RUN);

export function outFile(name: string): string {
  const p = join(OUT, name);
  mkdirSync(join(p, '..'), { recursive: true });
  return p;
}
export const writeJson = (name: string, data: unknown) => writeFileSync(outFile(name), `${JSON.stringify(data, null, 2)}\n`);

const sh = async (cmd: string, args: string[]) => (await run(cmd, args)).out.trim();

/** Môi trường của một lượt đo: nguồn điện, nắp, load (ghi theo từng vòng). */
export async function machine() {
  const [power, lid] = await Promise.all([
    sh('pmset', ['-g', 'batt']),
    sh('/bin/sh', ['-c', 'ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState']),
  ]);
  return {
    at: new Date().toISOString(),
    power: power.split('\n')[0]?.replace('Now drawing from ', ''),
    battery: power.split('\n')[1]?.trim(),
    lidClosed: /Yes/.test(lid),
    load: loadavg().map((x) => Number(x.toFixed(2))),
  };
}

/** Thông tin tĩnh của máy và Docker (ghi một lần mỗi lượt). */
export async function staticEnv() {
  const [dockerV, buildx, vm] = await Promise.all([
    sh('docker', ['version', '--format', '{{.Server.Version}} (API {{.Server.APIVersion}}), client {{.Client.Version}}']),
    sh('docker', ['buildx', 'version']),
    sh('docker', ['info', '--format', '{{.NCPU}} CPU, {{.MemTotal}} B, {{.OperatingSystem}}, driver {{.Driver}}']),
  ]);
  return {
    cpu: cpus()[0]?.model, cores: cpus().length, memGB: Math.round(totalmem() / 2 ** 30),
    macOS: await sh('sw_vers', ['-productVersion']), node: process.version, docker: dockerV, buildx, dockerVm: vm,
  };
}

/** Phát hiện máy ngủ: hai nhịp 1 s cách nhau quá 2,5 s (nhật ký 04/02 điểm 5). Lượt có khoảng ngủ phải chạy lại. */
export function startSleepDetector() {
  const gaps: { at: string; ms: number }[] = [];
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    if (now - last > 2500) gaps.push({ at: new Date(now).toISOString(), ms: now - last });
    last = now;
  }, 1000);
  return { gaps, stop: () => clearInterval(t) };
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
export const stats = (xs: number[]) => (xs.length ? { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length, values: xs } : null);

/** Registry trống (chỉ project compose lab-17-02): cache registry bắt đầu từ con số 0. */
export async function resetRegistry(): Promise<void> {
  await run('docker', ['compose', 'down', '-v'], { cwd: LAB_DIR });
  const up = await run('docker', ['compose', 'up', '-d', '--wait'], { cwd: LAB_DIR });
  if (!up.ok) throw new Error(`compose up lỗi: ${up.out}`);
}

/** Xoay thứ tự giữa các vòng để không bản nào luôn chạy trước. */
export const rotate = <T>(xs: readonly T[], round: number): T[] => (round % 2 === 0 ? [...xs] : [...xs].reverse());

export const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
