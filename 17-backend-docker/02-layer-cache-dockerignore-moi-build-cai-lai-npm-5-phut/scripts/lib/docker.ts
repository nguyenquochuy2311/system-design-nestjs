/**
 * Tiện ích chung cho test, script và bench của lab 17/02: dựng build context giống thư mục làm việc của CI/máy dev
 * (có `.git`, `node_modules` của host, `.env` giả), tạo/xóa builder BuildKit riêng của lab, build bằng
 * `docker buildx build --progress=plain`, đọc log (bước CACHED, thời gian từng bước, byte context), liệt kê context.
 * Mọi đồ Docker của lab mang tiền tố `lab-17-02` (tag, builder) hoặc nhãn `lab.id=17-02` để dọn đúng chỗ.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const TMP_DIR = join(LAB_DIR, '.tmp');
export const CONTEXT_DIR = join(TMP_DIR, 'context');
export const LAB_LABEL = 'lab.id=17-02';
export const REGISTRY_HOST = process.env.REGISTRY_HOST ?? 'localhost:58500';
// Cùng phiên bản BuildKit (v0.25.1) với builder desktop-linux của Docker Desktop trên máy đo; ghim digest.
export const BUILDKIT_IMAGE = process.env.BUILDKIT_IMAGE ?? 'moby/buildkit:v0.25.1@sha256:79cc6476ab1a3371c9afd8b44e7c55610057c43e18d9b39b68e2b0c2475cc1b6';
export const CACHE_REF = `${REGISTRY_HOST}/lab-17-02/api:buildcache`;
/** Builder dùng cho test (giữ giữa các lần `pnpm test` để chạy lại nhanh; `pnpm clean` xóa). */
export const TEST_BUILDER = 'lab-17-02-test';
/** `.env` giả của máy dev: giá trị mẫu, KHÔNG phải secret thật. Dùng để kiểm `.env` có lọt vào build context không. */
export const FAKE_ENV = '# .env giả của lab 17/02 — giá trị mẫu, không phải secret thật\nLAB_FAKE_API_KEY=gia-tri-mau-khong-phai-secret\n';
/** Dependency thêm ở kịch bản "thêm một thư viện": không có dependency con, tải từ npm registry thật. */
export const ADDED_DEPENDENCY = 'dayjs@1.11.21';

export type Variant = 'naive' | 'pattern';
export const VARIANTS: Record<Variant, { dockerfile: string; target: string; tag: string }> = {
  naive: { dockerfile: 'apps/api/Dockerfile.naive', target: 'app', tag: 'lab-17-02/api:naive' },
  pattern: { dockerfile: 'apps/api/Dockerfile', target: 'runtime', tag: 'lab-17-02/api:pattern' },
};

export interface CmdResult {
  ok: boolean;
  code: number | null;
  ms: number;
  out: string;
}

/** Chạy lệnh không qua shell, gom stdout+stderr theo thứ tự xuất hiện. Không chặn event loop (bench có bộ phát hiện máy ngủ). */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CmdResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(cmd, args, { cwd: opts.cwd ?? LAB_DIR, env: { ...process.env, ...opts.env } });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', (err) => chunks.push(Buffer.from(String(err))));
    child.stdin.end();
    child.on('close', (code) => resolve({ ok: code === 0, code, ms: performance.now() - t0, out: Buffer.concat(chunks).toString('utf8') }));
  });
}

/** Lệnh có pipe: bash với pipefail để mã thoát là của lệnh hỏng đầu tiên, không phải của lệnh cuối (nhật ký 2026-10-09). */
export const bash = (script: string, opts: { cwd?: string } = {}) => run('/bin/bash', ['-o', 'pipefail', '-c', script], opts);

// ---------- Build context giống thư mục làm việc của CI / máy dev ----------

/** Không có trong một lần checkout (đều nằm trong .gitignore của lab). */
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

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ci', GIT_AUTHOR_EMAIL: 'ci@lab.local', GIT_COMMITTER_NAME: 'ci', GIT_COMMITTER_EMAIL: 'ci@lab.local',
  GIT_AUTHOR_DATE: '2026-10-09T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-09T00:00:00Z',
};

/**
 * Build context giống thư mục làm việc của một job CI (checkout → `pnpm install` để lint/test → `docker build`) hay máy dev:
 * bản sao mã nguồn của lab (bỏ những gì .gitignore loại) ở `.tmp/context/`, `git init` + commit ngày cố định (`.git` thật),
 * `pnpm install` trên host (`node_modules` của macOS, như máy dev), và một `.env` giả.
 * Nguồn không đổi thì giữ nguyên context cũ (cache `COPY` vẫn trúng giữa các lần chạy).
 */
export async function prepareContext(dest = CONTEXT_DIR): Promise<string> {
  const files = listSourceFiles(LAB_DIR);
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update('\0').update(readFileSync(join(LAB_DIR, f))).update('\0');
  const digest = hash.digest('hex');
  const stamp = `${dest}.sha256`;
  const fresh = existsSync(join(dest, '.git')) && existsSync(join(dest, 'node_modules')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest;
  if (!fresh) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const f of files) {
      mkdirSync(join(dest, f, '..'), { recursive: true });
      cpSync(join(LAB_DIR, f), join(dest, f));
    }
    for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'ci checkout']]) {
      const r = await run('git', args, { cwd: dest, env: GIT_ENV });
      if (!r.ok) throw new Error(`git ${args.join(' ')} lỗi trong context: ${r.out}`);
    }
    const inst = await run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: dest });
    if (!inst.ok) throw new Error(`pnpm install trong context lỗi: ${inst.out.slice(-2000)}`);
    writeFileSync(stamp, digest);
  }
  writeFileSync(join(dest, '.env'), FAKE_ENV);
  return dest;
}

/** File đã theo dõi trong context có thay đổi? Dùng để chắc phép thử đã khôi phục khớp byte. */
export async function contextDirty(dest = CONTEXT_DIR): Promise<string> {
  return (await run('git', ['status', '--porcelain'], { cwd: dest })).out.trim();
}

export interface Edit {
  file: string;
  from: string;
  to: string;
}

/** Áp sửa đổi lên file trong context; mỗi `from` phải xuất hiện đúng một lần. Trả hàm khôi phục nguyên văn. */
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

/** "Sửa một dòng trong src": thêm một dòng comment có nội dung duy nhất (nhật ký 17/01 điểm 8: không được trúng cache cũ). */
export const editSourceLine = (tagText: string, dir = CONTEXT_DIR) =>
  applyEdits([{ file: 'apps/api/src/health.controller.ts', from: '  @Get()\n', to: `  // sửa một dòng: ${tagText} ${Date.now()}\n  @Get()\n` }], dir);

/**
 * "Thêm một dependency": `pnpm add` thật trên host trong context (đổi apps/api/package.json, pnpm-lock.yaml, node_modules),
 * như lập trình viên làm. Trả hàm khôi phục: file đã theo dõi về commit (git checkout), node_modules cài lại từ lockfile cũ.
 */
export async function addDependency(opts: { spec?: string; exact?: boolean; dir?: string } = {}): Promise<() => Promise<void>> {
  const { spec = ADDED_DEPENDENCY, exact = true, dir = CONTEXT_DIR } = opts;
  const r = await run('pnpm', ['--filter', '@lab/api', 'add', spec, ...(exact ? ['--save-exact'] : []), '--prefer-offline'], { cwd: dir });
  if (!r.ok) throw new Error(`pnpm add ${spec}: ${r.out.slice(-2000)}`);
  return async () => {
    const co = await run('git', ['checkout', '--', '.'], { cwd: dir });
    if (!co.ok) throw new Error(`git checkout trong context: ${co.out}`);
    const inst = await run('pnpm', ['install', '--frozen-lockfile', '--offline'], { cwd: dir });
    if (!inst.ok) throw new Error(`pnpm install khôi phục context: ${inst.out.slice(-2000)}`);
  };
}

// ---------- Builder BuildKit riêng của lab ----------

/**
 * Builder `docker-container` mới (mô phỏng runner CI tạm: không layer cache, không cache mount, không base image).
 * `network=host`: BuildKit dùng mạng của máy ảo Docker nên `localhost:58500` là registry của lab (BuildKit tự dùng HTTP
 * cho localhost).
 */
export async function createBuilder(name: string): Promise<CmdResult> {
  if (!name.startsWith('lab-17-02-')) throw new Error(`builder của lab phải có tiền tố lab-17-02-: ${name}`);
  await removeBuilder(name);
  const r = await run('docker', ['buildx', 'create', '--name', name, '--driver', 'docker-container',
    '--driver-opt', `image=${BUILDKIT_IMAGE}`, '--driver-opt', 'network=host', '--bootstrap']);
  if (!r.ok) throw new Error(`buildx create ${name}: ${r.out}`);
  return r;
}

/** Xóa builder của lab (container BuildKit + volume trạng thái: layer cache và cache mount). */
export async function removeBuilder(name: string): Promise<void> {
  if (!name.startsWith('lab-17-02-')) throw new Error(`chỉ xóa builder của lab: ${name}`);
  if ((await run('docker', ['buildx', 'inspect', name])).ok) await run('docker', ['buildx', 'rm', '--force', name]);
}

export async function ensureBuilder(name: string): Promise<void> {
  const r = await run('docker', ['buildx', 'inspect', '--bootstrap', name]);
  if (!r.ok) await createBuilder(name);
}

/** Tên builder của lab (`docker buildx ls --format json`: một dòng JSON mỗi builder; định dạng text liệt kê cả node). */
export const labBuilders = async () =>
  (await run('docker', ['buildx', 'ls', '--format', 'json'])).out.split('\n').filter((l) => l.startsWith('{'))
    .map((l) => (JSON.parse(l) as { Name: string }).Name).filter((n) => n.startsWith('lab-17-02-'));

/**
 * Đưa base image vào builder mới (giống runner kéo base image trước khi build), để thời gian build không gồm
 * phần tải base từ Docker Hub. Trả thời gian kéo.
 */
export async function warmBaseImage(builder: string, context = CONTEXT_DIR): Promise<number> {
  const dir = join(TMP_DIR, 'warm-base'); // thư mục riêng, trống: không gửi gì ngoài Dockerfile
  mkdirSync(dir, { recursive: true });
  const nodeImage = /ARG NODE_IMAGE=(\S+)/.exec(readFileSync(join(context, VARIANTS.pattern.dockerfile), 'utf8'))?.[1];
  writeFileSync(join(dir, 'Dockerfile'), `FROM ${nodeImage}\nRUN true\n`);
  const r = await run('docker', ['buildx', 'build', '--builder', builder, '--progress=plain', dir]);
  if (!r.ok) throw new Error(`kéo base image vào ${builder}: ${r.out.slice(-1500)}`);
  return r.ms;
}

// ---------- Build và đọc log ----------

export interface BuildOptions {
  variant: Variant;
  builder: string;
  context?: string;
  /** Ghi đè Dockerfile (đường dẫn tương đối trong context), cho phép thử âm. */
  dockerfile?: string;
  target?: string;
  noCache?: boolean;
  noCacheFilter?: string;
  cacheFrom?: boolean;
  cacheTo?: boolean;
  /** `none`: không xuất image (kết quả chỉ ở build cache của builder); `load`: nạp image vào Docker với tag của biến thể. */
  output?: 'none' | 'load';
}

export interface Step {
  id: number;
  name: string;
  cached: boolean;
  seconds: number | null;
  error: boolean;
}

export interface BuildLog {
  steps: Step[];
  /** Bước Dockerfile (dạng `[stage i/n]`, không gồm `[internal]` hay xuất cache) và số bước CACHED trong đó. */
  dockerfileSteps: number;
  cachedSteps: number;
  /** Byte BuildKit nhận ở bước `load build context` (lần đầu trên builder là toàn bộ; sau đó chỉ phần đổi). */
  contextBytes: number | null;
  /** Số gói pnpm tải từ mạng / dùng lại từ kho, cộng mọi bước (đọc dòng `Progress: resolved …, reused …, downloaded …`). */
  pnpmDownloaded: number;
  pnpmReused: number;
}

export interface BuildResult extends CmdResult {
  log: BuildLog;
  args: string[];
}

const UNITS: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 };

/** Đọc log `--progress=plain` của BuildKit. Bỏ mã màu ANSI trước (công cụ trong RUN có thể in màu dù không có TTY). */
export function parseBuildLog(raw: string): BuildLog {
  const out = raw.replace(/\x1b\[[0-9;]*m/g, '');
  const steps = new Map<number, Step>();
  const lastContext = new Map<number, number>();
  const progress = new Map<number, { reused: number; downloaded: number }>();
  for (const line of out.split('\n')) {
    const m = /^#(\d+) (.*)$/.exec(line);
    if (!m) continue;
    const id = Number(m[1]);
    const rest = m[2]!;
    if (!steps.has(id)) steps.set(id, { id, name: rest, cached: false, seconds: null, error: false });
    const s = steps.get(id)!;
    if (rest === 'CACHED') s.cached = true;
    const done = /^DONE ([\d.]+)s$/.exec(rest);
    if (done) s.seconds = Number(done[1]);
    if (/^ERROR/.test(rest)) s.error = true;
    const ctx = /transferring context: ([\d.]+)([kKMG]?B)/.exec(rest);
    if (ctx) lastContext.set(id, Math.round(Number(ctx[1]) * (UNITS[ctx[2]!] ?? 1)));
    const pr = /Progress: resolved \d+, reused (\d+), downloaded (\d+)/.exec(rest);
    if (pr) progress.set(id, { reused: Number(pr[1]), downloaded: Number(pr[2]) }); // dòng cuối của mỗi bước là tổng
  }
  const list = [...steps.values()].sort((a, b) => a.id - b.id);
  const df = list.filter((s) => /^\[[\w-]+ \d+\/\d+\]/.test(s.name));
  const ctxStep = list.find((s) => s.name === '[internal] load build context');
  const sum = (k: 'reused' | 'downloaded') => [...progress.values()].reduce((a, p) => a + p[k], 0);
  return {
    steps: list,
    dockerfileSteps: df.length,
    cachedSteps: df.filter((s) => s.cached).length,
    contextBytes: ctxStep ? (lastContext.get(ctxStep.id) ?? 0) : null,
    pnpmDownloaded: sum('downloaded'),
    pnpmReused: sum('reused'),
  };
}

/** Bước đầu tiên có tên khớp (ví dụ `/pnpm install/`), để test hỏi "bước cài đặt có CACHED không". */
export const findStep = (log: BuildLog, re: RegExp) => log.steps.find((s) => /^\[[\w-]+ \d+\/\d+\]/.test(s.name) && re.test(s.name));

export function buildArgs(o: BuildOptions): string[] {
  const context = o.context ?? CONTEXT_DIR;
  const v = VARIANTS[o.variant];
  const args = ['buildx', 'build', '--builder', o.builder, '--progress=plain', '--provenance=false', '--sbom=false',
    '-f', join(context, o.dockerfile ?? v.dockerfile), '--target', o.target ?? v.target];
  if (o.noCache) args.push('--no-cache');
  if (o.noCacheFilter) args.push('--no-cache-filter', o.noCacheFilter);
  // [PATTERN] cache registry: runner tạm nạp cache layer từ registry và xuất lại sau khi build (mode=max: cả stage trung gian).
  if (o.cacheFrom) args.push('--cache-from', `type=registry,ref=${CACHE_REF}`);
  if (o.cacheTo) args.push('--cache-to', `type=registry,ref=${CACHE_REF},mode=max`);
  if (o.output === 'load') args.push('--load', '-t', v.tag);
  args.push(context);
  return args;
}

export async function build(o: BuildOptions): Promise<BuildResult> {
  const args = buildArgs(o);
  const r = await run('docker', args);
  return { ...r, log: parseBuildLog(r.out), args };
}

// ---------- Nội dung build context mà BuildKit nhận ----------

export interface ContextListing {
  files: { path: string; size: number }[];
  totalBytes: number;
  byTopLevel: Record<string, { files: number; bytes: number }>;
  has: { nodeModules: boolean; git: boolean; env: boolean };
  buildMs: number;
}

/**
 * [PATTERN] Kiểm context bằng chính thứ BuildKit nhận, không bằng việc đọc `.dockerignore`: build stage `context-probe`
 * (`FROM scratch` + `COPY . /ctx`) của Dockerfile cần kiểm — ignore-file áp dụng đúng như khi build thật — xuất ra tar
 * và liệt kê. Stage này không nằm trên đường tới target thật nên build thường không chạy nó.
 */
export async function listContext(variant: Variant, opts: { builder?: string; context?: string; dockerfile?: string } = {}): Promise<ContextListing> {
  const context = opts.context ?? CONTEXT_DIR;
  const builder = opts.builder ?? TEST_BUILDER;
  const logFile = join(TMP_DIR, `context-probe-${variant}-${process.pid}.log`);
  mkdirSync(TMP_DIR, { recursive: true });
  const df = join(context, opts.dockerfile ?? VARIANTS[variant].dockerfile);
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const r = await bash(`docker buildx build --builder ${q(builder)} --progress=plain -f ${q(df)} --target context-probe --output type=tar,dest=- ${q(context)} 2>${q(logFile)} | tar -tvf -`);
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  rmSync(logFile, { force: true });
  if (!r.ok) throw new Error(`context-probe ${variant}: ${r.out.slice(-1000)}\n${log.slice(-2000)}`);
  const files: { path: string; size: number }[] = [];
  // bsdtar -tv: "-rw-r--r--  0 0      0        1234 Oct  9 02:39 ctx/package.json" (symlink: "... ctx/a -> b")
  for (const line of r.out.split('\n')) {
    const m = /^(\S)\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(.+?)(?: -> .*)?$/.exec(line);
    if (!m || m[1] === 'd') continue;
    const path = m[3]!.replace(/^ctx\//, '');
    files.push({ path, size: m[1] === '-' ? Number(m[2]) : 0 });
  }
  const byTopLevel: ContextListing['byTopLevel'] = {};
  for (const f of files) {
    const top = f.path.split('/')[0]!;
    byTopLevel[top] ??= { files: 0, bytes: 0 };
    byTopLevel[top].files++;
    byTopLevel[top].bytes += f.size;
  }
  const seg = (re: RegExp) => files.some((f) => f.path.split('/').some((p) => re.test(p)));
  return {
    files,
    totalBytes: files.reduce((a, f) => a + f.size, 0),
    byTopLevel,
    has: { nodeModules: seg(/^node_modules$/), git: seg(/^\.git$/), env: files.some((f) => /(^|\/)\.env$/.test(f.path)) },
    buildMs: r.ms,
  };
}

// ---------- Container ----------

/** Chạy image vừa build, gọi /health từ trong container (không mở cổng ra host). */
export async function smoke(tag: string, timeoutMs = 30_000): Promise<{ ok: boolean; body: string; logs: string }> {
  const name = `lab-17-02-smoke-${process.pid}-${Date.now()}`;
  const st = await run('docker', ['run', '-d', '--name', name, '--label', LAB_LABEL, tag]);
  if (!st.ok) return { ok: false, body: '', logs: st.out };
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await run('docker', ['exec', name, 'node', '-e',
        "fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(t=>{process.stdout.write(t)}).catch(()=>process.exit(1))"]);
      if (r.ok && r.out.includes('"status":"ok"')) return { ok: true, body: r.out, logs: '' };
      await new Promise((res) => setTimeout(res, 300));
    }
    return { ok: false, body: '', logs: (await run('docker', ['logs', name])).out };
  } finally {
    await run('docker', ['rm', '-f', name]);
  }
}
