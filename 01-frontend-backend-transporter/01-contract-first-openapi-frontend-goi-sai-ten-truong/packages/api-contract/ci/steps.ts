/**
 * Các bước "hợp đồng" của CI, dùng chung cho `pnpm contract:ci`, test và script đo.
 * Mỗi bước trả mã thoát, thời gian và output để script đo ghi lại bước nào đỏ, đỏ ở đâu.
 */
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_DIR = fileURLToPath(new URL('../../../', import.meta.url));
export const SPEC = 'packages/api-contract/openapi.yaml';
export const RULESET = 'packages/api-contract/.spectral.yaml';
export const GENERATED = 'packages/api-contract/generated/schema.d.ts';
export const OASDIFF_IMAGE = process.env.OASDIFF_IMAGE ?? 'tufin/oasdiff:v1.33.0';
const BIN = (name: string) => resolve(LAB_DIR, 'node_modules/.bin', name);

export interface StepResult {
  step: string;
  ok: boolean;
  exitCode: number | null;
  ms: number;
  output: string;
}

function run(step: string, cmd: string, args: string[], env: Record<string, string> = {}): StepResult {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { cwd: LAB_DIR, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 });
  const ms = performance.now() - t0;
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
  return { step, ok: r.status === 0, exitCode: r.status, ms, output };
}

const inLab = (p: string) => relative(LAB_DIR, resolve(LAB_DIR, p));

/** Bước 1: lint spec (bộ luật spectral:oas + luật camelCase / định dạng lỗi). */
export const lintSpec = (spec = SPEC, ruleset = RULESET) =>
  run('lint', BIN('spectral'), ['lint', inLab(spec), '--ruleset', inLab(ruleset), '--fail-severity', 'warn']);

/** Bước 2a: sinh type TypeScript từ spec. */
export const generateTypes = (spec = SPEC, out = GENERATED) =>
  run('generate', BIN('openapi-typescript'), [inLab(spec), '-o', inLab(out)]);

/** Bước 2b: `tsc` toàn bộ lab (web dùng type vừa sinh). */
export const typecheck = () => run('tsc', BIN('tsc'), ['--noEmit', '-p', 'tsconfig.json']);

/** Bước 3: test hợp đồng của backend (response theo schema, mọi operation có test). */
export const contractTest = (env: Record<string, string> = {}) =>
  run('contract-test', BIN('vitest'), ['run', 'test/customers-contract.test.ts'], env);

/**
 * Bước 4: so spec mới với spec của nhánh chính, chặn thay đổi phá vỡ.
 * [PATTERN] `--fail-on ERR` mới làm CI đỏ; thiếu cờ này oasdiff in lỗi nhưng vẫn thoát 0.
 */
export function diffSpec(base: string, revision: string, { failOn = true }: { failOn?: boolean } = {}): StepResult {
  const args = ['run', '--rm', '--network', 'none', '-v', `${LAB_DIR}:/lab:ro`, OASDIFF_IMAGE, 'breaking', `/lab/${inLab(base)}`, `/lab/${inLab(revision)}`];
  if (failOn) args.push('--fail-on', 'ERR');
  return run('diff', 'docker', args);
}
