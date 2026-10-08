/**
 * Chạy 4 bước hợp đồng như CI: lint → generate + tsc → test hợp đồng → diff với spec của nhánh chính.
 *   pnpm contract:ci [spec-nhánh-chính]
 * Mặc định spec nhánh chính lấy bằng `git show HEAD:<spec>` (chưa commit thì so với chính nó).
 * Thay đổi phá vỡ đã được duyệt: BREAKING_APPROVED=1 (vẫn in danh sách, không làm đỏ).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractTest, diffSpec, generateTypes, LAB_DIR, lintSpec, SPEC, typecheck, type StepResult } from '../packages/api-contract/ci/steps.js';

function baseSpec(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  const out = join(LAB_DIR, '.tmp', 'base-openapi.yaml');
  mkdirSync(join(LAB_DIR, '.tmp'), { recursive: true });
  try {
    const rel = execFileSync('git', ['ls-files', '--full-name', SPEC], { cwd: LAB_DIR, encoding: 'utf8' }).trim();
    if (!rel) throw new Error('spec chưa được git theo dõi');
    writeFileSync(out, execFileSync('git', ['show', `HEAD:${rel}`], { cwd: LAB_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    return '.tmp/base-openapi.yaml';
  } catch {
    console.log('• Spec chưa có trong git HEAD: so với chính nó');
    return SPEC;
  }
}

const results: StepResult[] = [];
const show = (r: StepResult) => {
  results.push(r);
  console.log(`${r.ok ? '✔' : '✖'} ${r.step} (${(r.ms / 1000).toFixed(2)} s)`);
  if (!r.ok) console.log(r.output.trim().split('\n').slice(0, 25).map((l) => `    ${l}`).join('\n'));
};
show(lintSpec());
show(generateTypes());
show(typecheck());
show(contractTest());
const diff = diffSpec(baseSpec(), SPEC, { failOn: process.env.BREAKING_APPROVED !== '1' });
show(diff);
if (process.env.BREAKING_APPROVED === '1') console.log(diff.output.trim());
process.exit(results.every((r) => r.ok) ? 0 : 1);
