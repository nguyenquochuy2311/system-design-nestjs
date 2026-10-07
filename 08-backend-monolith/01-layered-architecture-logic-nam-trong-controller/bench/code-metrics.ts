/**
 * Chỉ số về code của hai bản, đo bằng công cụ thật:
 * - ESLint (luật max-lines-per-function, complexity với ngưỡng 1 / 0 để mọi hàm đều được báo kèm số đo);
 * - dependency-cruiser (cùng .dependency-cruiser.cjs với CI);
 * - quét mã nguồn tìm nơi hiện thực từng quy tắc (mẫu regex ghi trong RULE_PATTERNS, ai cũng chạy lại được).
 *   RUN=main pnpm bench:metrics      # kết quả: bench/results/<RUN>/code-metrics.json
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cruise, type ICruiseResult } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';
import { ESLint } from 'eslint';

const OUT = join('bench/results', process.env.RUN ?? 'main');
mkdirSync(OUT, { recursive: true });
const VARIANTS = { truoc: 'src/truoc', sau: 'src/sau' } as const;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));

// --- 1. ESLint: số dòng (bỏ dòng trống và comment) và độ phức tạp của TỪNG hàm ---
interface FnMetric {
  file: string;
  line: number;
  name: string;
  lines: number;
  complexity: number;
}
async function functionMetrics(dir: string): Promise<FnMetric[]> {
  const eslint = new ESLint({
    overrideConfig: {
      rules: {
        'max-lines-per-function': ['warn', { max: 1, skipBlankLines: true, skipComments: true }],
        complexity: ['warn', 0],
      },
    },
  });
  const byFn = new Map<string, FnMetric>();
  for (const result of await eslint.lintFiles([dir])) {
    for (const m of result.messages) {
      const file = relative(process.cwd(), result.filePath);
      const key = `${file}:${m.line}:${m.column}`;
      const fn = byFn.get(key) ?? { file, line: m.line, name: m.message.split(' has ')[0] ?? '?', lines: 1, complexity: 1 };
      const lines = /too many lines \((\d+)\)/.exec(m.message);
      const complexity = /complexity of (\d+)/.exec(m.message);
      if (lines) fn.lines = Number(lines[1]);
      if (complexity) fn.complexity = Number(complexity[1]);
      byFn.set(key, fn);
    }
  }
  return [...byFn.values()].sort((a, b) => b.lines - a.lines);
}

const ENTRY_POINT = /(presentation\/|\.(controller|job)\.ts$)/;
function summarize(fns: FnMetric[]) {
  const pick = (list: FnMetric[], k: 'lines' | 'complexity') => list.reduce((best, f) => (f[k] > (best?.[k] ?? -1) ? f : best), list[0]);
  const entry = fns.filter((f) => ENTRY_POINT.test(f.file));
  const describe = (f?: FnMetric) => (f ? { at: `${f.file}:${f.line}`, name: f.name, lines: f.lines, complexity: f.complexity } : null);
  return {
    functions: fns.length,
    over30Lines: fns.filter((f) => f.lines > 30).length,
    overComplexity10: fns.filter((f) => f.complexity > 10).length,
    longest: describe(pick(fns, 'lines')),
    mostComplex: describe(pick(fns, 'complexity')),
    longestInEntryPoints: describe(pick(entry, 'lines')),
    mostComplexInEntryPoints: describe(pick(entry, 'complexity')),
    longestInControllers: describe(pick(fns.filter((f) => f.file.endsWith('.controller.ts')), 'lines')),
  };
}

// --- 2. Nơi hiện thực quy tắc: dòng mã khớp mẫu (không tính comment) ---
const RULE_PATTERNS: Record<string, RegExp> = {
  'tỉ lệ chiết khấu hạng Vàng (500 phần vạn)': /(rateBps\s*=\s*500|gold:\s*500)/,
  'ngưỡng đơn lớn 50 triệu': /50_000_000/,
  'so sánh với hạn mức công nợ': />\s*[\w.]*\.(credit_limit|creditLimit)\b/,
};
function ruleLocations(dir: string) {
  const out: Record<string, string[]> = {};
  for (const [rule, re] of Object.entries(RULE_PATTERNS)) {
    out[rule] = files(dir).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((text, i) => ({ text: text.trim(), n: i + 1 }))
        .filter(({ text }) => !text.startsWith('//') && !text.startsWith('*') && re.test(text))
        .map(({ text, n }) => `${f}:${n}: ${text}`),
    );
  }
  return out;
}

// --- 3. Số dòng mã (không tính dòng trống) theo file ---
function lineCounts(dir: string) {
  const perFile = files(dir).map((f) => {
    const lines = readFileSync(f, 'utf8').split('\n');
    const nonBlank = lines.filter((l) => l.trim() !== '');
    const code = nonBlank.filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
    return { file: f, nonBlank: nonBlank.length, code: code.length };
  });
  return { files: perFile.length, code: perFile.reduce((s, f) => s + f.code, 0), perFile };
}

// --- 4. Vi phạm hướng phụ thuộc ---
async function dependencyViolations(dir: string) {
  const options = await extractDepcruiseOptions('./.dependency-cruiser.cjs');
  const { output } = await cruise([dir], options);
  const violations = (output as ICruiseResult).summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
  const byRule: Record<string, number> = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  return { total: violations.length, byRule, violations };
}

const report: Record<string, unknown> = { measuredAt: new Date().toISOString() };
for (const [variant, dir] of Object.entries(VARIANTS)) {
  const fns = await functionMetrics(dir);
  report[variant] = {
    summary: summarize(fns),
    lineCounts: lineCounts(dir),
    ruleLocations: ruleLocations(dir),
    dependencyViolations: await dependencyViolations(dir),
    functions: fns,
  };
}
writeFileSync(join(OUT, 'code-metrics.json'), JSON.stringify(report, null, 2));

for (const variant of Object.keys(VARIANTS)) {
  const r = report[variant] as {
    summary: unknown;
    lineCounts: { files: number; code: number };
    ruleLocations: Record<string, string[]>;
    dependencyViolations: { total: number; byRule: unknown };
  };
  console.log(`\n=== ${variant}`);
  console.log(JSON.stringify(r.summary, null, 1));
  console.log('files/code lines:', r.lineCounts.files, r.lineCounts.code);
  for (const [rule, at] of Object.entries(r.ruleLocations)) console.log(`${rule}: ${at.length} chỗ\n  ${at.join('\n  ')}`);
  console.log('dependency violations:', r.dependencyViolations.total, JSON.stringify(r.dependencyViolations.byRule));
}
