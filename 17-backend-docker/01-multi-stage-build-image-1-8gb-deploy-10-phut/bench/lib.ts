/** Tiện ích cho script đo: thư mục kết quả, môi trường máy, bộ phát hiện máy ngủ, registry local, trung vị. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { LAB_DIR, REGISTRY_HOST, run } from '../scripts/lib/docker.js';

export const RUN = process.env.RUN ?? 'main';
export const OUT = join(LAB_DIR, 'bench/results', RUN);

export function outFile(name: string): string {
  const p = join(OUT, name);
  mkdirSync(join(p, '..'), { recursive: true });
  return p;
}
export const writeJson = (name: string, data: unknown) => writeFileSync(outFile(name), `${JSON.stringify(data, null, 2)}\n`);

const sh = async (cmd: string, args: string[]) => (await run(cmd, args)).out.trim();

/** Môi trường của một lượt đo: máy, nguồn điện, nắp, load, Docker/BuildKit. */
export async function machine() {
  const [power, lid, dockerV, buildx, buildkit, vm] = await Promise.all([
    sh('pmset', ['-g', 'batt']),
    sh('/bin/sh', ['-c', 'ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState']),
    sh('docker', ['version', '--format', '{{.Server.Version}} (API {{.Server.APIVersion}}), client {{.Client.Version}}']),
    sh('docker', ['buildx', 'version']),
    sh('/bin/sh', ['-c', "docker buildx inspect desktop-linux | grep -m1 'BuildKit version'"]),
    sh('docker', ['info', '--format', '{{.NCPU}} CPU, {{.MemTotal}} B, {{.OperatingSystem}}, driver {{.Driver}} {{json .DriverStatus}}']),
  ]);
  return {
    at: new Date().toISOString(),
    cpu: cpus()[0]?.model, cores: cpus().length, memGB: Math.round(totalmem() / 2 ** 30),
    macOS: await sh('sw_vers', ['-productVersion']), node: process.version,
    power: power.split('\n')[0]?.replace("Now drawing from ", ''),
    battery: power.split('\n')[1]?.trim(),
    lidClosed: /Yes/.test(lid),
    load: loadavg().map((x) => Number(x.toFixed(2))),
    docker: dockerV, buildx, buildkit: buildkit.replace(/\s+/g, ' '), dockerVm: vm,
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
export const stats = (xs: number[]) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length, values: xs });

/** Registry trống: xóa container + volume của compose lab rồi dựng lại (chỉ project lab-17-01). */
export async function resetRegistry(): Promise<void> {
  await run('docker', ['compose', 'down', '-v'], { cwd: LAB_DIR });
  const up = await run('docker', ['compose', 'up', '-d', '--wait'], { cwd: LAB_DIR });
  if (!up.ok) throw new Error(`compose up lỗi: ${up.out}`);
}

/** Byte nén mà một lần pull phải tải: tổng kích thước layer + config trong manifest trên registry. */
export async function registryManifestBytes(repo: string, tag: string) {
  const accept = [
    'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json',
  ].join(', ');
  const get = async (ref: string) => {
    const res = await fetch(`http://${REGISTRY_HOST.replace('localhost', '127.0.0.1')}/v2/${repo}/manifests/${ref}`, { headers: { Accept: accept } });
    if (!res.ok) throw new Error(`manifest ${repo}:${ref} → ${res.status}`);
    return (await res.json()) as { mediaType?: string; manifests?: { digest: string; platform?: { architecture: string } }[]; layers?: { size: number }[]; config?: { size: number } };
  };
  let m = await get(tag);
  if (m.manifests) m = await get(m.manifests.find((x) => x.platform?.architecture === 'arm64')?.digest ?? m.manifests[0]!.digest);
  const layers = m.layers ?? [];
  return { layers: layers.length, compressedBytes: layers.reduce((a, l) => a + l.size, 0) + (m.config?.size ?? 0), mediaType: m.mediaType };
}

/** Xoay thứ tự giữa các vòng để không bản nào luôn chạy trước. */
export const rotate = <T>(xs: readonly T[], round: number): T[] => (round % 2 === 0 ? [...xs] : [...xs].reverse());

/** Byte context BuildKit nhận (dòng `transferring context: 1.23MB` cuối cùng trong log plain). */
export function contextBytes(log: string): number | null {
  const all = [...log.matchAll(/transferring context: ([\d.]+)([kMG]?B)/g)];
  const last = all.at(-1);
  if (!last) return null;
  const mult: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 };
  return Math.round(Number(last[1]) * (mult[last[2]!] ?? 1));
}
