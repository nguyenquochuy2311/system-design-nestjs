/**
 * Đo "trước" (một stage) và "sau" (nhiều stage) trên cùng máy, cùng context giống CI checkout.
 *   RUN=main ROUNDS=3 pnpm bench:measure                # mọi pha
 *   RUN=trial ROUNDS=1 PHASES=size,push pnpm bench:measure
 * Pha:
 *   build  — build lạnh (`--no-cache`: không dùng layer cache; base image đã có sẵn, pnpm vẫn tải gói từ npm registry),
 *            build ấm (không đổi gì, mọi bước CACHED), build sau khi sửa một dòng trong apps/api/src.
 *   size   — kích thước nén (content), unpacked (tổng layer trong `docker history`), tar export, số layer, số file.
 *   push   — `docker push` lên registry local TRỐNG (dựng lại volume mỗi lần).
 *   pull   — pull "máy sạch": daemon Docker mới tinh trong container docker:dind (anonymous volume mới mỗi lần),
 *            kéo từ registry qua mạng Compose; và pull trên daemon chính sau khi xóa tag của lab (base có thể còn).
 *   trivy  — quét lỗ hổng bằng Trivy kéo image từ registry local; DB cache trong volume lab-17-01-trivy-cache.
 * Kết quả thô: bench/results/<RUN>/measure.json (+ history-*.txt, trivy/*.json).
 */
import { writeFileSync } from 'node:fs';
import {
  applyEdits, buildImage, DOCKERFILES, IMAGES, imageInfo, LAB_DIR, listImageFiles, prepareContext, REGISTRY_HOST, run, bash,
  checkRuntimeContents, devDependencyNames,
} from '../scripts/lib/docker.js';
import { contextBytes, machine, outFile, registryManifestBytes, resetRegistry, rotate, RUN, startSleepDetector, stats, writeJson } from './lib.js';

const ROUNDS = Number(process.env.ROUNDS ?? 3);
const PHASES = new Set((process.env.PHASES ?? 'build,size,push,pull,trivy').split(','));
const VARIANTS = ['single', 'multi'] as const;
type Variant = (typeof VARIANTS)[number];
const BUILD: Record<Variant, { dockerfile: string; tag: string; target?: string }> = {
  single: { dockerfile: DOCKERFILES.single, tag: IMAGES.single },
  multi: { dockerfile: DOCKERFILES.multi, tag: IMAGES.multi, target: 'runtime' },
};
const DIND_IMAGE = 'docker:28.5.1-dind@sha256:ea9d20492ca1caaaba78e68453433895d256173c79281756e88b745647fcbcfd';
const TRIVY_IMAGE = 'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const TRIVY_CACHE = 'lab-17-01-trivy-cache';
const NETWORK = 'lab-17-01_default';

const sleep = startSleepDetector();
const result: Record<string, unknown> = { run: RUN, rounds: ROUNDS, phases: [...PHASES], env: { start: await machine() } };
const save = () => writeJson('measure.json', { ...result, sleepGaps: sleep.gaps });
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
await prepareContext();

async function mustBuild(v: Variant, extra: { noCache?: boolean } = {}) {
  const r = await buildImage({ ...BUILD[v], ...extra });
  if (!r.ok) throw new Error(`build ${v} lỗi:\n${r.out.slice(-3000)}`);
  return r;
}

// ---------- build ----------
if (PHASES.has('build')) {
  const rows: { round: number; variant: Variant; kind: 'cold' | 'warm' | 'code-change'; ms: number; contextBytes: number | null; cachedSteps: number; retried: boolean }[] = [];
  const cached = (out: string) => (out.match(/^#\d+ CACHED$/gm) ?? []).length;
  for (let r = 0; r < ROUNDS; r++) {
    const env = await machine();
    log(`build vòng ${r + 1}: nguồn ${env.power}, load ${env.load.join(' ')}`);
    for (const v of rotate(VARIANTS, r)) {
      const cold = await mustBuild(v, { noCache: true });
      rows.push({ round: r + 1, variant: v, kind: 'cold', ms: cold.ms, contextBytes: contextBytes(cold.out), cachedSteps: cached(cold.out), retried: cold.retried });
      const warm = await mustBuild(v);
      rows.push({ round: r + 1, variant: v, kind: 'warm', ms: warm.ms, contextBytes: contextBytes(warm.out), cachedSteps: cached(warm.out), retried: warm.retried });
      // Sửa một dòng code, build, khôi phục. Nội dung có mốc thời gian: không được trúng cache của vòng hay lượt chạy trước
      // (lượt thử đầu trúng cache của một lượt hỏng giữa chừng và báo 1,3 s).
      const restore = applyEdits([{ file: 'apps/api/src/health.controller.ts', from: "  @Get()\n", to: `  // sửa một dòng: ${RUN} vòng ${r + 1} ${v} ${Date.now()}\n  @Get()\n` }]);
      let edit;
      try { edit = await mustBuild(v); } finally { restore(); }
      rows.push({ round: r + 1, variant: v, kind: 'code-change', ms: edit.ms, contextBytes: contextBytes(edit.out), cachedSteps: cached(edit.out), retried: edit.retried });
      log(`  ${v}: lạnh ${(cold.ms / 1000).toFixed(1)} s · ấm ${(warm.ms / 1000).toFixed(1)} s · sửa code ${(edit.ms / 1000).toFixed(1)} s`);
    }
    (rows as unknown[]).push({ round: r + 1, env });
    result.build = rows;
    save();
  }
  const pick = (v: Variant, k: string) => stats(rows.filter((x) => x.variant === v && x.kind === k).map((x) => Math.round(x.ms)));
  result.buildSummary = Object.fromEntries(VARIANTS.map((v) => [v, { cold: pick(v, 'cold'), warm: pick(v, 'warm'), codeChange: pick(v, 'code-change') }]));
  // Image cuối cùng phải là bản build từ mã nguồn gốc (bước sửa code đã khôi phục): build lại (trúng cache).
  for (const v of VARIANTS) await mustBuild(v);
  save();
}

// ---------- size ----------
if (PHASES.has('size')) {
  const devDeps = devDependencyNames();
  const sizes: Record<string, unknown> = {};
  for (const v of VARIANTS) {
    await mustBuild(v);
    const info = await imageInfo(BUILD[v].tag);
    const hist = await run('docker', ['history', '--no-trunc', '--human=false', '--format', '{{.Size}}\t{{.CreatedBy}}', BUILD[v].tag]);
    writeFileSync(outFile(`history-${v}.txt`), hist.out);
    const unpacked = hist.out.split('\n').filter(Boolean).reduce((a, l) => a + Number(l.split('\t')[0]), 0);
    const exp = await bash(`cid=$(docker create --label lab.id=17-01 ${BUILD[v].tag}) && docker export "$cid" | wc -c; docker rm -f "$cid" >/dev/null`);
    const diskUsage = (await run('docker', ['image', 'ls', '--format', '{{.Size}}', BUILD[v].tag])).out.trim();
    const files = await listImageFiles(BUILD[v].tag);
    const violations = checkRuntimeContents(files, devDeps);
    sizes[v] = {
      imageId: info.id, contentBytes: info.size, unpackedBytesFromHistory: unpacked, exportTarBytes: Number(exp.out.trim().split('\n')[0]),
      dockerImageLsDiskUsage: diskUsage, layers: info.layers, files: files.length, user: info.user || 'root',
      violationKinds: [...new Set(violations.map((x) => x.kind))],
    };
    log(`size ${v}: nén ${(info.size / 1e6).toFixed(1)} MB · unpacked ${(unpacked / 1e6).toFixed(1)} MB · ls ${diskUsage} · ${info.layers} layer · ${files.length} file`);
  }
  result.size = sizes;
  save();
}

// ---------- push ----------
if (PHASES.has('push')) {
  const rows: { round: number; variant: Variant; ms: number; ok: boolean }[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    log(`push vòng ${r + 1}: ${(await machine()).power}`);
    for (const v of rotate(VARIANTS, r)) {
      await resetRegistry(); // registry trống: mọi layer đều phải tải lên
      const remote = `${REGISTRY_HOST}/lab-17-01/api:${v}`;
      await run('docker', ['tag', BUILD[v].tag, remote]);
      const p = await run('docker', ['push', remote]);
      if (!p.ok) throw new Error(`push ${v}: ${p.out}`);
      rows.push({ round: r + 1, variant: v, ms: Math.round(p.ms), ok: p.ok });
      log(`  push ${v}: ${(p.ms / 1000).toFixed(1)} s`);
    }
  }
  // Registry cuối cùng chứa cả hai bản cho pha pull và trivy.
  await resetRegistry();
  const manifests: Record<string, unknown> = {};
  for (const v of VARIANTS) {
    const remote = `${REGISTRY_HOST}/lab-17-01/api:${v}`;
    await run('docker', ['tag', BUILD[v].tag, remote]);
    const p = await run('docker', ['push', remote]);
    if (!p.ok) throw new Error(`push ${v}: ${p.out}`);
    manifests[v] = await registryManifestBytes('lab-17-01/api', v);
  }
  result.push = { rows, summary: Object.fromEntries(VARIANTS.map((v) => [v, stats(rows.filter((x) => x.variant === v).map((x) => x.ms))])), manifests };
  save();
}

// ---------- pull ----------
if (PHASES.has('pull')) {
  const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const cold: { round: number; variant: Variant; ms: number; storageDriver: string; sizeInDind: number }[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    log(`pull máy sạch vòng ${r + 1}: ${(await machine()).power}`);
    for (const v of rotate(VARIANTS, r)) {
      const name = `lab-17-01-dind-${r + 1}-${v}`;
      // [đo] daemon mới tinh: anonymous volume /var/lib/docker mới, xóa cùng container (rm -v).
      const st = await run('docker', ['run', '-d', '--privileged', '--name', name, '--label', 'lab.id=17-01', '--network', NETWORK,
        '-e', 'DOCKER_TLS_CERTDIR=', DIND_IMAGE, '--insecure-registry', 'registry:5000']);
      if (!st.ok) throw new Error(`dind: ${st.out}`);
      try {
        for (let i = 0; i < 120 && !(await run('docker', ['exec', name, 'docker', 'info'])).ok; i++) await sleepMs(500);
        const driver = (await run('docker', ['exec', name, 'docker', 'info', '--format', '{{.Driver}}'])).out.trim();
        const images = (await run('docker', ['exec', name, 'docker', 'images', '-q'])).out.trim();
        if (images) throw new Error(`dind không sạch: ${images}`);
        const p = await run('docker', ['exec', name, 'docker', 'pull', `registry:5000/lab-17-01/api:${v}`]);
        if (!p.ok) throw new Error(`pull ${v}: ${p.out}`);
        const size = Number((await run('docker', ['exec', name, 'docker', 'image', 'inspect', '--format', '{{.Size}}', `registry:5000/lab-17-01/api:${v}`])).out.trim());
        cold.push({ round: r + 1, variant: v, ms: Math.round(p.ms), storageDriver: driver, sizeInDind: size });
        log(`  pull sạch ${v}: ${(p.ms / 1000).toFixed(1)} s (driver ${driver})`);
      } finally {
        await run('docker', ['rm', '-f', '-v', name]);
      }
    }
  }
  // Daemon chính (chỉ khi HOST_PULL=1): xóa hai tag của lab rồi pull lại. Với containerd image store, blob còn trong
  // content store (BuildKit giữ) nên mọi layer "Already exists" — không phải pull lạnh. Lượt thử còn làm build kế tiếp
  // lỗi "parent snapshot ... does not exist", nên mặc định tắt (xem README 3.4).
  const host: { round: number; variant: Variant; ms: number; layerStatus: Record<string, number> }[] = [];
  for (let r = 0; r < (process.env.HOST_PULL === '1' ? ROUNDS : 0); r++) {
    for (const v of rotate(VARIANTS, r)) {
      const remote = `${REGISTRY_HOST}/lab-17-01/api:${v}`;
      await run('docker', ['rmi', BUILD[v].tag, remote]);
      const p = await run('docker', ['pull', remote]);
      if (!p.ok) throw new Error(`pull host ${v}: ${p.out}`);
      const status: Record<string, number> = {};
      for (const m of p.out.matchAll(/^[0-9a-f]{12}: (.+)$/gm)) status[m[1]!] = (status[m[1]!] ?? 0) + 1;
      await run('docker', ['tag', remote, BUILD[v].tag]);
      host.push({ round: r + 1, variant: v, ms: Math.round(p.ms), layerStatus: status });
      if (r === 0) writeFileSync(outFile(`pull-host-${v}.txt`), p.out);
      log(`  pull daemon chính ${v}: ${(p.ms / 1000).toFixed(1)} s ${JSON.stringify(status)}`);
    }
  }
  result.pull = {
    cold, host,
    summary: Object.fromEntries(VARIANTS.map((v) => [v, {
      cold: stats(cold.filter((x) => x.variant === v).map((x) => x.ms)),
      host: stats(host.filter((x) => x.variant === v).map((x) => x.ms)),
    }])),
  };
  save();
}

// ---------- trivy ----------
if (PHASES.has('trivy')) {
  await run('docker', ['volume', 'create', '--label', 'lab.id=17-01', TRIVY_CACHE]);
  const trivy = (args: string[]) => run('docker', ['run', '--rm', '--label', 'lab.id=17-01', '--network', NETWORK, '-v', `${TRIVY_CACHE}:/root/.cache/trivy`, TRIVY_IMAGE, ...args]);
  const dl = await trivy(['image', '--download-db-only', '--no-progress']);
  if (!dl.ok) throw new Error(`trivy DB: ${dl.out}`);
  const ver = JSON.parse((await trivy(['version', '--format', 'json'])).out) as Record<string, unknown>;
  const scans: Record<string, unknown> = {};
  for (const v of VARIANTS) {
    const s = await trivy(['image', '--skip-db-update', '--insecure', '--scanners', 'vuln', '--list-all-pkgs', '--format', 'json', '--timeout', '20m', '--quiet', `registry:5000/lab-17-01/api:${v}`]);
    if (!s.ok) throw new Error(`trivy ${v}: ${s.out.slice(-2000)}`);
    writeFileSync(outFile(`trivy/${v}.json`), s.out);
    type Vuln = { VulnerabilityID: string; Severity: string; PkgName: string; PkgPath?: string };
    type Pkg = { FilePath?: string };
    const rep = JSON.parse(s.out) as { Metadata?: { OS?: unknown }; Results?: { Target: string; Class: string; Type: string; Packages?: Pkg[]; Vulnerabilities?: Vuln[] }[] };
    // Gói npm nằm ở đâu: node_modules của app, npm/corepack/yarn có sẵn trong base image node, hay pnpm cài toàn cục.
    const where = (p = '') => p.startsWith('app/') ? 'app' : p.includes('lib/node_modules/npm/') ? 'npm (base)'
      : p.includes('lib/node_modules/pnpm/') ? 'pnpm (toàn cục)' : p.includes('corepack') ? 'corepack (base)' : p.includes('yarn') ? 'yarn (base)' : 'khác';
    const bySeverity: Record<string, number> = {};
    const byClass: Record<string, Record<string, number>> = {};
    const nodeByLocation: Record<string, Record<string, number>> = {};
    const packages: Record<string, number> = {};
    const nodePackagesByLocation: Record<string, number> = {};
    const hcIds = new Set<string>();
    for (const res of rep.Results ?? []) {
      packages[res.Type] = (packages[res.Type] ?? 0) + (res.Packages?.length ?? 0);
      if (res.Type === 'node-pkg') for (const p of res.Packages ?? []) nodePackagesByLocation[where(p.FilePath)] = (nodePackagesByLocation[where(p.FilePath)] ?? 0) + 1;
      for (const x of res.Vulnerabilities ?? []) {
        bySeverity[x.Severity] = (bySeverity[x.Severity] ?? 0) + 1;
        (byClass[res.Class] ??= {})[x.Severity] = (byClass[res.Class]![x.Severity] ?? 0) + 1;
        if (res.Type === 'node-pkg') (nodeByLocation[where(x.PkgPath)] ??= {})[x.Severity] = (nodeByLocation[where(x.PkgPath)]![x.Severity] ?? 0) + 1;
        if (x.Severity === 'HIGH' || x.Severity === 'CRITICAL') hcIds.add(x.VulnerabilityID);
      }
    }
    scans[v] = {
      ms: Math.round(s.ms), os: rep.Metadata?.OS, bySeverity, byClass, nodeByLocation, packages, nodePackagesByLocation,
      highCriticalUniqueIds: hcIds.size, targets: (rep.Results ?? []).map((x) => `${x.Type}:${x.Target}`).slice(0, 40),
    };
    log(`trivy ${v}: ${JSON.stringify(bySeverity)} · gói ${JSON.stringify(packages)}`);
  }
  result.trivy = { image: TRIVY_IMAGE, version: ver, scans };
  save();
}

result.env = { ...(result.env as object), end: await machine() };
sleep.stop();
save();
log(`xong → ${outFile('measure.json').replace(LAB_DIR, '')} · khoảng ngủ: ${sleep.gaps.length}`);
