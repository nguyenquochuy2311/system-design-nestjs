/** Tiện ích chung cho script đo: sửa mã nguồn tạm thời rồi khôi phục, ghi môi trường máy. */
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { LAB_DIR } from '../packages/api-contract/ci/steps.js';
import type { Edit } from './changes.js';

export const OUT_ROOT = join(LAB_DIR, 'bench/results', process.env.RUN ?? 'main');

export function outDir(name: string): string {
  const dir = join(OUT_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Áp các sửa đổi; mỗi `from` phải xuất hiện đúng một lần. Trả hàm khôi phục nguyên trạng. */
export function applyEdits(edits: Edit[]): () => void {
  const originals = new Map<string, string>();
  try {
    for (const e of edits) {
      const path = join(LAB_DIR, e.file);
      if (!originals.has(path)) originals.set(path, readFileSync(path, 'utf8'));
      const text = readFileSync(path, 'utf8');
      const count = text.split(e.from).length - 1;
      if (count !== 1) throw new Error(`"${e.from.slice(0, 60)}" xuất hiện ${count} lần trong ${e.file} (cần đúng 1)`);
      writeFileSync(path, text.replace(e.from, () => e.to));
    }
  } catch (err) {
    for (const [p, t] of originals) writeFileSync(p, t);
    throw err;
  }
  return () => { for (const [p, t] of originals) writeFileSync(p, t); };
}

/** Chụp nội dung các file để cuối script so lại: không được sót thay đổi nào. */
export function snapshot(files: string[]): () => string[] {
  const before = new Map(files.map((f) => [f, readFileSync(join(LAB_DIR, f), 'utf8')]));
  return () => [...before].filter(([f, t]) => readFileSync(join(LAB_DIR, f), 'utf8') !== t).map(([f]) => f);
}

const sh = (cmd: string) => { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } };

export function machine() {
  return {
    at: new Date().toISOString(),
    cpu: cpus()[0]?.model, cores: cpus().length, memGB: Math.round(totalmem() / 2 ** 30),
    macOS: sh('sw_vers -productVersion'), node: process.version,
    power: sh('pmset -g batt | head -2').replace(/\s+/g, ' '),
    lidClosed: /Yes/.test(sh('ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState')),
    load1: Number(loadavg()[0]!.toFixed(2)),
    docker: sh("docker version --format '{{.Server.Version}}'"),
  };
}

/** Lỗi `tsc` dạng `file(line,col): error TSxxxx: ...` → danh sách file có lỗi. */
export const tscErrorFiles = (output: string) =>
  [...new Set([...output.matchAll(/^([^\s(]+)\(\d+,\d+\): error/gm)].map((m) => m[1]!))];

export function runProbe(variant: 'truoc' | 'sau'): { ok: boolean; fields?: Record<string, string>; createStatus?: number; error?: string } {
  const r = spawnSync(join(LAB_DIR, 'node_modules/.bin/tsx'), ['bench/runtime-probe.ts', variant], { cwd: LAB_DIR, encoding: 'utf8' });
  const line = r.stdout.trim().split('\n').pop() ?? '';
  try { return JSON.parse(line); } catch { return { ok: false, error: `probe hỏng: ${r.stderr.slice(0, 500)}` }; }
}

export const truncate = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n…(cắt ${s.length - n} ký tự)` : s);
export const writeJson = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2));
