/**
 * Phép thử âm: gỡ hoặc phá từng lớp chặn, chạy lại đúng 10 thay đổi phá vỡ, xem lớp đó có thật sự là thứ làm CI đỏ.
 *   RUN=main pnpm bench:negative       # kết quả: bench/results/<RUN>/negative/
 *   ajv-off            — validateResponse không kiểm schema nữa (chỉ còn kiểm status) → test hợp đồng ở biến thể A
 *   stale-types        — biến thể B nhưng bỏ bước generate (schema.d.ts cũ) → tsc; bước kiểm "sinh lại không khác" thì sao
 *   diff-no-fail-on    — biến thể B, oasdiff không có --fail-on ERR → mã thoát
 *   spectral-no-rule   — trường snake_case, ruleset chỉ có spectral:oas → lint
 * Lớp "interface viết tay" chính là bản trước trong bench/breaking-drills.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractTest, diffSpec, GENERATED, generateTypes, LAB_DIR, lintSpec, RULESET, SPEC, typecheck } from '../packages/api-contract/ci/steps.js';
import { CHANGES } from './changes.js';
import { applyEdits, machine, outDir, snapshot, truncate, writeJson } from './lib.js';

const OUT = outDir('negative');
const BASE = join('bench/results', process.env.RUN ?? 'main', 'negative', 'base-openapi.yaml');
writeFileSync(join(LAB_DIR, BASE), readFileSync(join(LAB_DIR, SPEC), 'utf8'));
const VALIDATOR = 'packages/api-contract/index.ts';
const verifyRestored = snapshot([...new Set([...CHANGES.flatMap((c) => [...c.sauCode, ...c.spec].map((e) => e.file)), GENERATED, VALIDATOR])]);
const testsRan = (out: string) =>
  [...(/Tests\s+([^\n]+)/.exec(out)?.[1] ?? '').matchAll(/(\d+) (?:failed|passed)/g)].reduce((a, m) => a + Number(m[1]), 0);
const result: Record<string, unknown> = { env: machine() };

// 1. Ajv tắt: chỉ còn so status.
{
  const restoreValidator = applyEdits([{ file: VALIDATOR, from: '    return fn(body) ? [] : toErrors(`${operationId} ${status}`, fn.errors);', to: '    return []; // PHÉP THỬ ÂM: bỏ kiểm schema' }]);
  const rows = [];
  try {
    for (const c of CHANGES) {
      const restore = applyEdits(c.sauCode);
      try {
        const r = contractTest();
        rows.push({ id: c.id, key: c.key, red: !r.ok, testsRan: testsRan(r.output), output: truncate(r.output, 1500) });
      } finally { restore(); }
    }
  } finally { restoreValidator(); }
  result.ajvOff = { red: rows.filter((r) => r.red).map((r) => r.id), allRanTests: rows.every((r) => r.testsRan > 0), rows };
  console.log(`ajv-off: test hợp đồng đỏ ở ${rows.filter((r) => r.red).length}/10 (${rows.filter((r) => r.red).map((r) => `#${r.id}`).join(' ')})`);
}

// 2. Type cũ: sửa spec + code (B) nhưng không sinh lại type.
{
  const rows = [];
  mkdirSync(join(LAB_DIR, '.tmp'), { recursive: true });
  for (const c of CHANGES) {
    const restore = applyEdits([...c.spec, ...c.sauCode]);
    try {
      const tsc = typecheck();
      const fresh = generateTypes(SPEC, '.tmp/negative-fresh.d.ts');
      const stale = readFileSync(join(LAB_DIR, '.tmp/negative-fresh.d.ts'), 'utf8') !== readFileSync(join(LAB_DIR, GENERATED), 'utf8');
      rows.push({ id: c.id, key: c.key, tscRed: !tsc.ok, freshnessCheckRed: fresh.ok && stale, tscOutput: truncate(tsc.output, 1500) });
    } finally { restore(); }
  }
  result.staleTypes = { tscRed: rows.filter((r) => r.tscRed).map((r) => r.id), freshnessRed: rows.filter((r) => r.freshnessCheckRed).map((r) => r.id), rows };
  console.log(`stale-types: tsc đỏ ${rows.filter((r) => r.tscRed).length}/10, kiểm "sinh lại không khác" đỏ ${rows.filter((r) => r.freshnessCheckRed).length}/10`);
}

// 3. oasdiff không --fail-on ERR.
{
  const rows = [];
  for (const c of CHANGES) {
    const restore = applyEdits(c.spec);
    try {
      const withFlag = diffSpec(BASE, SPEC);
      const noFlag = diffSpec(BASE, SPEC, { failOn: false });
      rows.push({ id: c.id, key: c.key, withFlagExit: withFlag.exitCode, noFlagExit: noFlag.exitCode, noFlagPrintsErrors: /\berror\b/.test(noFlag.output) });
    } finally { restore(); }
  }
  result.diffNoFailOn = { rows };
  console.log(`diff-no-fail-on: có cờ thoát ≠0 ở ${rows.filter((r) => r.withFlagExit !== 0).length}/10; không cờ thoát ≠0 ở ${rows.filter((r) => r.noFlagExit !== 0).length}/10 dù in lỗi ở ${rows.filter((r) => r.noFlagPrintsErrors).length}/10`);
}

// 4. Spectral không có luật camelCase của đội.
{
  const restore = applyEdits([{ file: SPEC, from: '        creditLimit:\n', to: '        credit_limit:\n' }, { file: SPEC, from: REQUIRED_LINE(), to: REQUIRED_LINE().replace('creditLimit', 'credit_limit') }]);
  try {
    writeFileSync(join(LAB_DIR, '.tmp/ruleset-oas-only.yaml'), 'extends:\n  - spectral:oas\n');
    const team = lintSpec(SPEC, RULESET);
    const oasOnly = lintSpec(SPEC, '.tmp/ruleset-oas-only.yaml');
    result.spectralNoRule = { teamRuleset: { exit: team.exitCode, output: truncate(team.output, 1500) }, oasOnly: { exit: oasOnly.exitCode, output: truncate(oasOnly.output, 1500) } };
    console.log(`spectral-no-rule: ruleset của đội thoát ${team.exitCode}, chỉ spectral:oas thoát ${oasOnly.exitCode}`);
  } finally { restore(); }
}

function REQUIRED_LINE() { return 'required: [id, name, email, phone, tier, address, tags, creditLimit, createdAt]'; }

result.filesNotRestored = verifyRestored();
writeJson(join(OUT, 'negative.json'), result);
console.log(`file chưa khôi phục: ${JSON.stringify(result.filesNotRestored)}`);
if ((result.filesNotRestored as string[]).length) process.exit(1);
