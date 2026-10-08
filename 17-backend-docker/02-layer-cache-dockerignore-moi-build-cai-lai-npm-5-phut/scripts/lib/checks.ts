/**
 * Hai phép kiểm cốt lõi của bài, dùng chung cho test và phép thử âm:
 *   (a) build context mà BuildKit nhận không có node_modules, .git, .env;
 *   (b) sửa một dòng trong apps/api/src thì bước cài dependency vẫn CACHED (đọc log --progress=plain).
 */
import { build, editSourceLine, findStep, listContext, type BuildResult, type ContextListing, type Variant } from './docker.js';

export type ContextViolation = 'node_modules' | '.git' | '.env';

/** (a) Những thứ không được có trong build context (kiểm trên danh sách file thật của stage context-probe). */
export function contextViolations(l: ContextListing): ContextViolation[] {
  const v: ContextViolation[] = [];
  if (l.has.nodeModules) v.push('node_modules');
  if (l.has.git) v.push('.git');
  if (l.has.env) v.push('.env');
  return v;
}

export async function checkContext(variant: Variant, opts: { builder?: string; dockerfile?: string } = {}) {
  const listing = await listContext(variant, opts);
  return { listing, violations: contextViolations(listing) };
}

export interface SrcEditReport {
  ok: boolean;
  warm: BuildResult;
  edited: BuildResult;
  /** Bước cài dependency (pnpm install) — phải CACHED khi chỉ sửa src. */
  installCached: boolean | null;
  fetchCached: boolean | null;
  deployCached: boolean | null;
  /** Bước biên dịch API — phải chạy lại (chứng minh bản sửa đã vào context). */
  apiBuildCached: boolean | null;
}

/**
 * (b) Build một lần (làm ấm cache), sửa một dòng trong apps/api/src (nội dung duy nhất), build lại và đọc log:
 * bước nào CACHED, bước nào chạy lại. Context được khôi phục khớp byte sau khi build.
 */
export async function srcEditReport(variant: Variant, opts: { builder: string; dockerfile?: string }): Promise<SrcEditReport> {
  const warm = await build({ variant, ...opts });
  if (!warm.ok) throw new Error(`build làm ấm ${variant} lỗi:\n${warm.out.slice(-3000)}`);
  const restore = editSourceLine(`kiểm cache ${variant}`);
  let edited: BuildResult;
  try {
    edited = await build({ variant, ...opts });
  } finally {
    restore();
  }
  const cached = (re: RegExp) => findStep(edited.log, re)?.cached ?? null;
  return {
    ok: edited.ok,
    warm,
    edited,
    installCached: cached(/RUN .*pnpm install/),
    fetchCached: cached(/RUN .*pnpm fetch/),
    deployCached: cached(/RUN .*pnpm .*deploy/),
    apiBuildCached: cached(/RUN pnpm --filter "?@lab\/api(\.\.\.)?"? run build/),
  };
}
