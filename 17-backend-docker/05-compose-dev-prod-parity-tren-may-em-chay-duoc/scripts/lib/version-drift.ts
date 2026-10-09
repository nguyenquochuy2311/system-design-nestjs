import { existsSync, readFileSync } from 'node:fs';
import semver from 'semver';
import { parse } from 'yaml';

/** File "phiên bản production" (giả lập): dịch vụ → phiên bản đang chạy, và Node của runtime. */
export interface ProductionVersions {
  services: Record<string, string>;
  node?: string;
}

export interface DriftInput {
  composeFile: string;
  overrideFile?: string;
  productionFile: string;
  nvmrcFile?: string;
  packageFile?: string;
  /** Node đang chạy lệnh (mặc định process.version): CI phải chạy đúng bản trong .nvmrc. */
  runningNode?: string;
}

export interface Finding {
  level: 'error' | 'warning';
  target: string;
  message: string;
}

interface ComposeFile {
  services?: Record<string, { image?: string } | null>;
}

/** "postgres:16.15@sha256:…" → repo, tag, digest. Cổng của registry ("localhost:5000/x:tag") không bị nhầm là tag. */
export function parseImage(ref: string): { repo: string; tag?: string; digest?: string } {
  const [name, digest] = ref.split('@') as [string, string | undefined];
  const slash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  const hasTag = colon > slash;
  return {
    repo: hasTag ? name.slice(0, colon) : name,
    ...(hasTag ? { tag: name.slice(colon + 1) } : {}),
    ...(digest ? { digest } : {}),
  };
}

/** Phần số đầu tag: "16.15-bookworm" → "16.15", "16" → "16", "latest" → undefined. */
export function versionOfTag(tag: string): string | undefined {
  return /^v?(\d+(?:\.\d+)*)/.exec(tag)?.[1];
}

/** "major.minor" của chuỗi phiên bản Node ("v20.19.6" → "20.19"). */
function minorOf(v: string): string {
  return v.replace(/^v/, '').split('.').slice(0, 2).join('.');
}

function readYaml(file: string): ComposeFile {
  return (parse(readFileSync(file, 'utf8')) ?? {}) as ComposeFile;
}

/** [PATTERN] So môi trường được khai báo (Compose, .nvmrc, engines) với phiên bản production; trả danh sách lệch. */
export function checkDrift(input: DriftInput): Finding[] {
  const findings: Finding[] = [];
  const err = (target: string, message: string) => findings.push({ level: 'error', target, message });
  const warn = (target: string, message: string) => findings.push({ level: 'warning', target, message });

  const production = JSON.parse(readFileSync(input.productionFile, 'utf8')) as ProductionVersions;
  const services = readYaml(input.composeFile).services ?? {};

  for (const [name, svc] of Object.entries(services)) {
    const ref = svc?.image;
    if (!ref) continue; // service build từ Dockerfile: không thuộc phạm vi so tag
    const expected = production.services[name];
    if (!expected) {
      err(name, `dịch vụ "${name}" (${ref}) có trong ${input.composeFile} nhưng không có trong ${input.productionFile}`);
      continue;
    }
    const { tag, digest } = parseImage(ref);
    const tagVersion = tag ? versionOfTag(tag) : undefined;
    if (!tag || !tagVersion) {
      err(name, `image "${ref}" không ghim phiên bản (tag "${tag ?? 'latest'}"); production chạy ${expected}`);
    } else if (tagVersion !== expected) {
      if (expected.startsWith(`${tagVersion}.`)) {
        err(name, `tag "${tag}" không ghim bản vá: là tag trôi, mỗi máy kéo vào lúc khác nhau có thể nhận bản khác; production chạy ${expected}, ghim "${expected}"`);
      } else {
        err(name, `tag "${tag}" (phiên bản ${tagVersion}) khác production ${expected}`);
      }
    }
    if (!digest) warn(name, `image "${ref}" không ghim digest: cùng một tag có thể trỏ tới image khác nhau giữa các máy`);
  }
  for (const name of Object.keys(production.services)) {
    if (!(name in services)) err(name, `production có dịch vụ "${name}" nhưng ${input.composeFile} không khai báo`);
  }

  // File override chỉ cho dev: đổi image ở đây nghĩa là dev chạy khác CI (CI không đọc override).
  if (input.overrideFile && existsSync(input.overrideFile)) {
    for (const [name, svc] of Object.entries(readYaml(input.overrideFile).services ?? {})) {
      if (svc?.image) err(name, `${input.overrideFile} đặt image "${svc.image}": dev sẽ chạy khác CI (CI không đọc file override)`);
    }
  }

  if (production.node) {
    const want = production.node.replace(/^v/, '');
    let nvmrc: string | undefined;
    if (input.nvmrcFile) {
      if (!existsSync(input.nvmrcFile)) err('node', `thiếu ${input.nvmrcFile}; production chạy Node ${want}`);
      else {
        nvmrc = readFileSync(input.nvmrcFile, 'utf8').trim().replace(/^v/, '');
        if (nvmrc !== want) err('node', `${input.nvmrcFile} ghi "${nvmrc}" khác production Node ${want}`);
      }
    }
    if (input.packageFile && nvmrc) {
      const engines = (JSON.parse(readFileSync(input.packageFile, 'utf8')) as { engines?: { node?: string } }).engines?.node;
      if (!engines) warn('node', `${input.packageFile} không có engines.node`);
      else if (!semver.valid(nvmrc) || !semver.satisfies(nvmrc, engines)) {
        err('node', `${input.nvmrcFile} "${nvmrc}" không thỏa engines.node "${engines}" trong ${input.packageFile}`);
      }
    }
    if (input.runningNode) {
      if (minorOf(input.runningNode) !== minorOf(want)) err('node', `Node đang chạy ${input.runningNode} khác production ${want} ở mức minor`);
      else if (input.runningNode.replace(/^v/, '') !== want) warn('node', `Node đang chạy ${input.runningNode} khác production ${want} ở bản vá`);
    }
  }
  return findings;
}
