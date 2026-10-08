/**
 * Tiện ích chung cho test, script và bench của lab 17/01: chuẩn bị build context giống CI checkout,
 * build image, đọc kích thước/layer, liệt kê file trong image, smoke test container.
 * Mọi image/container do lab tạo có tiền tố `lab-17-01` và nhãn `lab.id=17-01` để dọn đúng chỗ.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const CONTEXT_DIR = join(LAB_DIR, '.tmp/context');
export const LAB_LABEL = 'lab.id=17-01';
export const IMAGES = {
  single: 'lab-17-01/api:single',
  multi: 'lab-17-01/api:multi',
  testTarget: 'lab-17-01/api:test-target',
} as const;
export const DOCKERFILES = {
  single: 'apps/api/Dockerfile.single-stage',
  multi: 'apps/api/Dockerfile',
} as const;
export const REGISTRY_HOST = process.env.REGISTRY_HOST ?? 'localhost:58500';
export const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 3100);

export interface CmdResult {
  ok: boolean;
  code: number | null;
  ms: number;
  out: string;
}

/** Chạy lệnh không qua shell, gom stdout+stderr theo thứ tự xuất hiện. Không chặn event loop (bench có bộ phát hiện máy ngủ). */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<CmdResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(cmd, args, { cwd: opts.cwd ?? LAB_DIR, env: { ...process.env, ...opts.env } });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', (err) => chunks.push(Buffer.from(String(err))));
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
    child.on('close', (code) => resolve({ ok: code === 0, code, ms: performance.now() - t0, out: Buffer.concat(chunks).toString('utf8') }));
  });
}

/** Lệnh có pipe: chạy qua bash với pipefail để mã thoát là của lệnh hỏng đầu tiên, không phải của lệnh cuối (nhật ký 2026-10-09). */
export const bash = (script: string, opts: { cwd?: string } = {}) => run('/bin/bash', ['-o', 'pipefail', '-c', script], opts);

// ---------- Build context giống CI checkout ----------

/** Thư mục/file không có trong một lần checkout của CI (đều nằm trong .gitignore của lab). */
const NOT_IN_CHECKOUT = new Set(['node_modules', 'dist', '.tmp', '.data', '.cache', 'coverage', '.env']);

function listSourceFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (NOT_IN_CHECKOUT.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(base, full);
    if (rel === 'bench/results') continue;
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full, base));
    else out.push(rel);
  }
  return out;
}

/**
 * Tạo build context giống một lần checkout của CI: chép mã nguồn của lab (bỏ những gì .gitignore loại)
 * vào `.tmp/context/`, rồi `git init` + commit với ngày cố định để thư mục có `.git` thật như repo của đội.
 * Nguồn không đổi thì giữ nguyên context cũ (giữ `.git` y hệt, cache BuildKit của `COPY . .` vẫn trúng).
 */
export async function prepareContext(dest = CONTEXT_DIR): Promise<string> {
  const files = listSourceFiles(LAB_DIR);
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update('\0').update(readFileSync(join(LAB_DIR, f))).update('\0');
  const digest = hash.digest('hex');
  const stamp = `${dest}.sha256`;
  if (existsSync(join(dest, '.git')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) return dest;

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of files) {
    mkdirSync(join(dest, f, '..'), { recursive: true });
    cpSync(join(LAB_DIR, f), join(dest, f));
  }
  const env = {
    GIT_AUTHOR_NAME: 'ci', GIT_AUTHOR_EMAIL: 'ci@lab.local', GIT_COMMITTER_NAME: 'ci', GIT_COMMITTER_EMAIL: 'ci@lab.local',
    GIT_AUTHOR_DATE: '2026-10-09T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-09T00:00:00Z',
  };
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'ci checkout']]) {
    const r = await run('git', args, { cwd: dest, env });
    if (!r.ok) throw new Error(`git ${args.join(' ')} lỗi trong context: ${r.out}`);
  }
  writeFileSync(stamp, digest);
  return dest;
}

/** Context có thay đổi so với commit? Dùng để chắc phép thử đã khôi phục file khớp byte. */
export async function contextDirty(dest = CONTEXT_DIR): Promise<string> {
  const r = await run('git', ['status', '--porcelain'], { cwd: dest });
  return r.out.trim();
}

// ---------- Build và đọc image ----------

export interface BuildOptions {
  dockerfile: string;
  tag: string;
  target?: string;
  noCache?: boolean;
  noCacheFilter?: string;
  context?: string;
}

export interface BuildResult extends CmdResult {
  imageId: string | null;
  tag: string;
  retried: boolean;
}

/**
 * `docker build` (BuildKit của Docker Desktop, driver docker). Tắt attestation (provenance/SBOM) để kích thước
 * và số layer chỉ phản ánh nội dung image, giống nhau cho mọi bản.
 */
export async function buildImage(o: BuildOptions): Promise<BuildResult> {
  const context = o.context ?? CONTEXT_DIR;
  const iid = join(tmpdir(), `lab-17-01-iid-${randomBytes(6).toString('hex')}`);
  const args = ['build', '--progress=plain', '--provenance=false', '--sbom=false', '-f', join(context, o.dockerfile), '-t', o.tag, '--iidfile', iid];
  if (o.target) args.push('--target', o.target);
  if (o.noCache) args.push('--no-cache');
  if (o.noCacheFilter) args.push('--no-cache-filter', o.noCacheFilter);
  args.push(context);
  let r = await run('docker', args);
  // Docker Desktop + containerd image store: sau khi xóa/pull lại image dùng chung layer, lần build kế tiếp có thể lỗi
  // "failed to prepare extraction snapshot ... parent snapshot ... does not exist" ở bước unpack; chạy lại một lần là qua.
  let retried = false;
  if (!r.ok && r.out.includes('failed to prepare extraction snapshot')) {
    retried = true;
    r = await run('docker', args);
  }
  const imageId = existsSync(iid) ? readFileSync(iid, 'utf8').trim() : null;
  rmSync(iid, { force: true });
  return { ...r, imageId, tag: o.tag, retried };
}

export interface ImageInfo {
  id: string;
  size: number;
  layers: number;
  user: string;
  labels: Record<string, string>;
  cmd: string[];
}

export async function imageInfo(ref: string): Promise<ImageInfo> {
  const r = await run('docker', ['image', 'inspect', ref, '--format', '{{json .}}']);
  if (!r.ok) throw new Error(`docker image inspect ${ref}: ${r.out}`);
  const j = JSON.parse(r.out) as { Id: string; Size: number; RootFS: { Layers: string[] }; Config: { User?: string; Labels?: Record<string, string> | null; Cmd?: string[] } };
  return { id: j.Id, size: j.Size, layers: j.RootFS.Layers.length, user: j.Config.User ?? '', labels: j.Config.Labels ?? {}, cmd: j.Config.Cmd ?? [] };
}

/** Danh sách đường dẫn trong filesystem của image (gộp mọi layer), lấy bằng `docker create` + `docker export`. */
export async function listImageFiles(ref: string): Promise<string[]> {
  const name = `lab-17-01-inspect-${randomBytes(4).toString('hex')}`;
  const c = await run('docker', ['create', '--label', LAB_LABEL, '--name', name, ref]);
  if (!c.ok) throw new Error(`docker create ${ref}: ${c.out}`);
  try {
    const r = await bash(`docker export ${name} | tar -tf -`);
    if (!r.ok) throw new Error(`docker export ${ref}: ${r.out.slice(-500)}`);
    return r.out.split('\n').map((l) => l.replace(/^\.\//, '').replace(/\/$/, '')).filter(Boolean);
  } finally {
    await run('docker', ['rm', '-f', name]);
  }
}

/** Tên devDependencies khai báo trong monorepo (gốc + mọi package), đọc từ thư mục context. */
export function devDependencyNames(dir = CONTEXT_DIR): string[] {
  const names = new Set<string>();
  for (const p of ['package.json', 'apps/api/package.json', 'packages/shared/package.json']) {
    const pkg = JSON.parse(readFileSync(join(dir, p), 'utf8')) as { devDependencies?: Record<string, string> };
    for (const n of Object.keys(pkg.devDependencies ?? {})) names.add(n);
  }
  return [...names].sort();
}

export interface ContentViolation {
  kind: 'typescript' | 'source' | 'git' | 'devDependency' | 'pnpm' | 'unexpected-app-entry' | 'root';
  detail: string;
}

/**
 * [PATTERN] Bất biến của image runtime, kiểm trên nội dung thật của image (không tin Dockerfile):
 * không TypeScript, không mã nguồn `src/` của monorepo, không `.git`, không devDependency nào, không pnpm,
 * và `/app` chỉ gồm dist, node_modules, package.json.
 */
export function checkRuntimeContents(files: string[], devDeps: string[]): ContentViolation[] {
  const v: ContentViolation[] = [];
  const first = (re: RegExp) => files.find((f) => re.test(f));
  const push = (kind: ContentViolation['kind'], hit: string | undefined) => { if (hit) v.push({ kind, detail: hit }); };

  push('typescript', first(/(^|\/)node_modules\/(\.pnpm\/typescript@[^/]+\/node_modules\/)?typescript\/package\.json$/));
  // Mã nguồn của chính monorepo: thư mục src/ của app/package được chép vào image, hoặc của @lab/* đã inject vào node_modules.
  // Không bắt mọi `src/main.ts` trong node_modules: @nestjs/schematics có file mẫu `files/ts/src/main.ts` (báo nhầm ở lượt đầu).
  push('source', first(/^app\/((apps|packages)\/[^/]+\/)?src\/|(^|\/)node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?@lab\/[^/]+\/src\//));
  push('git', first(/(^|\/)\.git(\/|$)/));
  for (const dep of devDeps) {
    const flat = dep.replace('/', '+');
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    push('devDependency', first(new RegExp(`(^|/)node_modules/(${esc(dep)}/package\\.json$|\\.pnpm/${esc(flat)}@)`)));
  }
  push('pnpm', first(/(^|\/)(usr\/local\/lib\/node_modules\/pnpm|usr\/local\/bin\/pnpm)(\/|$)/));
  const appEntries = new Set(files.filter((f) => f.startsWith('app/')).map((f) => f.split('/')[1]!).filter(Boolean));
  for (const e of appEntries) if (!['dist', 'node_modules', 'package.json'].includes(e)) v.push({ kind: 'unexpected-app-entry', detail: `app/${e}` });
  return v;
}

/** uid của tiến trình chính trong container (chạy bằng chính `node` của image, không cần shell). */
export async function processUid(ref: string): Promise<string> {
  const r = await run('docker', ['run', '--rm', '--label', LAB_LABEL, '--entrypoint', 'node', ref, '-e', 'process.stdout.write(String(process.getuid()))']);
  if (!r.ok) throw new Error(`docker run ${ref}: ${r.out}`);
  return r.out.trim();
}

// ---------- Smoke test ----------

export interface SmokeResult {
  ok: boolean;
  ms: number;
  status?: number;
  body?: unknown;
  exitedWith?: number;
  logs: string;
  reason: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * [PATTERN] Smoke test: chạy container từ image vừa build, chờ `/health` trả 200 + `status: ok`.
 * Container thoát sớm (thiếu module production...) hoặc quá giờ → đỏ, kèm log để CI in ra.
 */
export async function smokeTest(ref: string, { port = SMOKE_PORT, timeoutMs = 30_000 } = {}): Promise<SmokeResult> {
  const name = `lab-17-01-smoke-${randomBytes(4).toString('hex')}`;
  const t0 = performance.now();
  const started = await run('docker', ['run', '-d', '--name', name, '--label', LAB_LABEL, '-p', `127.0.0.1:${port}:3000`, ref]);
  if (!started.ok) return { ok: false, ms: performance.now() - t0, logs: started.out, reason: 'docker run lỗi' };
  try {
    while (performance.now() - t0 < timeoutMs) {
      const st = await run('docker', ['inspect', name, '--format', '{{.State.Status}} {{.State.ExitCode}}']);
      const [state, code] = st.out.trim().split(' ');
      if (state === 'exited' || state === 'dead') {
        const logs = (await run('docker', ['logs', name])).out;
        return { ok: false, ms: performance.now() - t0, exitedWith: Number(code), logs, reason: `container thoát mã ${code}` };
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        const body: unknown = await res.json().catch(() => null);
        if (res.status === 200 && (body as { status?: string } | null)?.status === 'ok') {
          return { ok: true, ms: performance.now() - t0, status: res.status, body, logs: '', reason: 'ok' };
        }
      } catch {
        // chưa nghe cổng — thử lại
      }
      await sleep(250);
    }
    const logs = (await run('docker', ['logs', name])).out;
    return { ok: false, ms: performance.now() - t0, logs, reason: `quá ${timeoutMs} ms chưa có /health` };
  } finally {
    await run('docker', ['rm', '-f', name]);
  }
}

// ---------- Sửa file tạm trong context, khôi phục khớp byte ----------

export interface Edit {
  file: string;
  from: string;
  to: string;
}

/** Áp sửa đổi lên file trong `dir`; mỗi `from` phải xuất hiện đúng một lần. Trả hàm khôi phục nguyên văn. */
export function applyEdits(edits: Edit[], dir = CONTEXT_DIR): () => void {
  const originals = new Map<string, Buffer>();
  const restore = () => { for (const [p, b] of originals) writeFileSync(p, b); };
  try {
    for (const e of edits) {
      const path = join(dir, e.file);
      if (!originals.has(path)) originals.set(path, readFileSync(path));
      const text = readFileSync(path, 'utf8');
      const count = text.split(e.from).length - 1;
      if (count !== 1) throw new Error(`"${e.from.slice(0, 60)}" xuất hiện ${count} lần trong ${e.file} (cần đúng 1)`);
      writeFileSync(path, text.replace(e.from, () => e.to));
    }
  } catch (err) {
    restore();
    throw err;
  }
  return restore;
}

export const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
