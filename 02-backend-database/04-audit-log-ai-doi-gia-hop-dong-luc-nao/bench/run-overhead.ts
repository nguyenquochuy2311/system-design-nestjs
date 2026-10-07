// Overhead ghi của Audit Log, đo bằng k6 qua API thật (pnpm dev phải đang chạy ở 127.0.0.1:3100).
// Ba chế độ trên cùng seed 40.000 hợp đồng:
//   truoc   : UPDATE truoc.contracts một câu, không transaction, không nhật ký (hệ thống hiện tại)
//   sau-off : withActor (BEGIN, set_config, UPDATE, COMMIT) trên public.contracts, trigger nhật ký TẮT
//   sau-on  : như sau-off, trigger nhật ký BẬT  -> chênh sau-on − sau-off là chi phí của riêng trigger
// ROUNDS vòng, xoay thứ tự chế độ giữa các vòng, warm-up mỗi chế độ trước vòng 1 (quy ước bài 02/02).
// Ví dụ: RESULTS_DIR=bench/results/main ROUNDS=5 DURATION=30s pnpm bench:overhead
// Chỉ tổng hợp lại từ file đã có: SUMMARY_ONLY=1 RESULTS_DIR=bench/results/main pnpm bench:overhead
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAB_DIR } from '../src/shared/config';
import { adminClient, cpuBusyPercent, median, RESULTS_DIR, round, save, setAuditTrigger, vmStats } from './lib';

const MODES = ['truoc', 'sau-off', 'sau-on'] as const;
type Mode = (typeof MODES)[number];
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const DURATION = process.env.DURATION ?? '30s';
const WARMUP = process.env.WARMUP ?? '15s';
const VUS = Number(process.env.VUS ?? 10);
const CONTRACTS = Number(process.env.CONTRACTS ?? 40000);

/** Xoay vòng: vòng 1 truoc → sau-off → sau-on, vòng 2 sau-off → sau-on → truoc, ... */
const roundOrder = (r: number): Mode[] => MODES.map((_, i) => MODES[(i + r - 1) % MODES.length]!);

interface RunResult {
  name: string;
  mode: Mode;
  round: number;
  k6: { requests: number; failedRate: number; latency: { avg: number; med: number; p90: number; p95: number; p99: number; max: number } };
  db: { updateCalls: number; updateMeanMs: number; auditInsertCalls: number; auditInsertMeanMs: number; auditRowsAdded: number };
  vm: { loadavgBefore: number[]; loadavgAfter: number[]; cpuBusyPercent: number };
}

async function runOne(mode: Mode, roundNo: number, duration: string, name: string): Promise<RunResult> {
  const admin = await adminClient();
  try {
    await setAuditTrigger(admin, mode === 'sau-off' ? 'off' : 'on');
    const count = async () => (await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM audit.audit_log')).rows[0]!.n;
    const auditBefore = await count();
    await admin.query('SELECT pg_stat_statements_reset()');
    const vmBefore = await vmStats();

    const k6 = spawnSync(
      'k6',
      ['run', '--quiet', '-e', `MODE=${mode === 'truoc' ? 'truoc' : 'sau'}`, '-e', `VUS=${VUS}`, '-e', `DURATION=${duration}`, '-e', `CONTRACTS=${CONTRACTS}`,
        '-e', `NAME=${name}`, '-e', `RESULTS_DIR=${RESULTS_DIR}`, 'bench/update-contract.k6.js'],
      { cwd: LAB_DIR, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    if (k6.status !== 0) throw new Error(`k6 thoát mã ${k6.status} ở lượt ${name}`);

    const vmAfter = await vmStats();
    // pg_stat_statements.track = all: thấy cả câu INSERT chạy bên trong trigger.
    const { rows } = await admin.query<{ query: string; calls: number; mean: number }>(
      `SELECT query, calls::int AS calls, mean_exec_time AS mean FROM pg_stat_statements
       WHERE query ILIKE 'update%contracts%' OR query ILIKE 'insert into audit.audit_log%' ORDER BY calls DESC`,
    );
    const upd = rows.find((r) => /^update/i.test(r.query));
    const ins = rows.find((r) => /^insert into audit/i.test(r.query));
    const k6json = JSON.parse(readFileSync(join(RESULTS_DIR, `${name}.k6.json`), 'utf8'));
    const result: RunResult = {
      name,
      mode,
      round: roundNo,
      k6: { requests: k6json.requests, failedRate: k6json.failedRate, latency: k6json.latency },
      db: {
        updateCalls: upd?.calls ?? 0,
        updateMeanMs: upd?.mean ?? 0,
        auditInsertCalls: ins?.calls ?? 0,
        auditInsertMeanMs: ins?.mean ?? 0,
        auditRowsAdded: (await count()) - auditBefore,
      },
      vm: { loadavgBefore: vmBefore.loadavg, loadavgAfter: vmAfter.loadavg, cpuBusyPercent: cpuBusyPercent(vmBefore, vmAfter) },
    };
    save(`${name}.run.json`, result);
    console.log(`   DB: UPDATE ${result.db.updateCalls} lần, trung bình ${round(result.db.updateMeanMs, 4)} ms · INSERT nhật ký ${result.db.auditInsertCalls} lần · load ${vmAfter.loadavg[0]} · CPU máy ảo ${round(result.vm.cpuBusyPercent, 1)} %`);
    return result;
  } finally {
    await admin.query('ALTER TABLE public.contracts ENABLE TRIGGER contracts_audit').catch(() => undefined);
    await admin.end();
  }
}

function summarize(): string {
  const runs: RunResult[] = readdirSync(RESULTS_DIR)
    .filter((f) => /^overhead-.*-r\d+\.run\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')));
  const lines: string[] = [`# Overhead ghi (${runs.length} lượt, ${RESULTS_DIR})`, ''];
  lines.push('| Chế độ | Request / lượt | Trung vị | p95 | p99 | UPDATE trong DB (trung bình) | INSERT nhật ký trong DB | Load sau lượt | CPU máy ảo |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  const by = (m: Mode) => runs.filter((r) => r.mode === m).sort((a, b) => a.round - b.round);
  const fmt = (xs: number[], d = 2) => `${round(median(xs), d)} (${round(Math.min(...xs), d)} – ${round(Math.max(...xs), d)})`;
  for (const m of MODES) {
    const rs = by(m);
    if (!rs.length) continue;
    lines.push(
      `| ${m} | ${fmt(rs.map((r) => r.k6.requests), 0)} | ${fmt(rs.map((r) => r.k6.latency.med))} | ${fmt(rs.map((r) => r.k6.latency.p95))} | ${fmt(rs.map((r) => r.k6.latency.p99))} | ${fmt(rs.map((r) => r.db.updateMeanMs), 4)} ms | ${m === 'sau-on' ? fmt(rs.map((r) => r.db.auditInsertMeanMs), 4) + ' ms' : '—'} | ${fmt(rs.map((r) => r.vm.loadavgAfter[0]!), 2)} | ${fmt(rs.map((r) => r.vm.cpuBusyPercent), 1)} % |`,
    );
  }
  lines.push('', 'Chênh lệch theo từng vòng (ms):', '');
  lines.push('| Vòng | Thứ tự | p95 sau-on − sau-off | p95 sau-on − truoc | p50 sau-on − sau-off | p50 sau-on − truoc | UPDATE DB sau-on − sau-off |');
  lines.push('|---|---|---|---|---|---|---|');
  const rounds = [...new Set(runs.map((r) => r.round))].sort((a, b) => a - b);
  const diffs: Record<string, number[]> = { p95off: [], p95truoc: [], p50off: [], p50truoc: [], db: [] };
  for (const n of rounds) {
    const get = (m: Mode) => runs.find((r) => r.round === n && r.mode === m);
    const on = get('sau-on');
    const off = get('sau-off');
    const tr = get('truoc');
    if (!on || !off || !tr) continue;
    const d = {
      p95off: on.k6.latency.p95 - off.k6.latency.p95,
      p95truoc: on.k6.latency.p95 - tr.k6.latency.p95,
      p50off: on.k6.latency.med - off.k6.latency.med,
      p50truoc: on.k6.latency.med - tr.k6.latency.med,
      db: on.db.updateMeanMs - off.db.updateMeanMs,
    };
    for (const k of Object.keys(d) as (keyof typeof d)[]) diffs[k]!.push(d[k]);
    const order = roundOrder(n).join(' → ');
    lines.push(`| ${n} | ${order} | ${round(d.p95off, 2)} | ${round(d.p95truoc, 2)} | ${round(d.p50off, 2)} | ${round(d.p50truoc, 2)} | ${round(d.db, 4)} |`);
  }
  if (diffs.p95off!.length)
    lines.push(`| trung vị | | ${round(median(diffs.p95off!), 2)} | ${round(median(diffs.p95truoc!), 2)} | ${round(median(diffs.p50off!), 2)} | ${round(median(diffs.p50truoc!), 2)} | ${round(median(diffs.db!), 4)} |`);
  return lines.join('\n') + '\n';
}

if (!process.env.SUMMARY_ONLY) {
  const health = await fetch('http://127.0.0.1:3100/healthz').catch(() => undefined);
  if (!health?.ok) throw new Error('API chưa chạy: mở terminal khác và chạy `pnpm dev` trước');
  console.log(`Warm-up ${WARMUP} mỗi chế độ`);
  for (const m of MODES) await runOne(m, 0, WARMUP, `warmup-${m}`);
  for (let r = 1; r <= ROUNDS; r++) {
    for (const m of roundOrder(r)) {
      console.log(`Vòng ${r}: ${m}`);
      await runOne(m, r, DURATION, `overhead-${m}-r${r}`);
    }
  }
}
const text = summarize();
save('overhead-summary.md', text);
console.log(text);
