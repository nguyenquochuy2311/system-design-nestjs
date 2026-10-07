// In bảng Markdown từ các file <NAME>.run.json trong một thư mục kết quả (mặc định bench/results).
//   pnpm bench:summary                       # mọi lượt trong bench/results
//   RESULTS_DIR=bench/results/main pnpm bench:summary   # các lượt đo dùng cho mục 5.1
//   RESULTS_DIR=bench/results/recheck pnpm bench:summary
import { readdirSync, readFileSync } from 'node:fs';

const DIR = process.env.RESULTS_DIR ?? 'bench/results';

interface Stat {
  min: number;
  med: number;
  max: number;
}
interface Phase {
  requests: number;
  failedRate: number;
  errorsByKind: Record<string, number>;
  okLatencyMs: { med: number; p95: number; p99: number };
}

const f1 = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—');
const f2 = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : '—');
const range = (s: Stat | null) => (s ? `${f1(s.min)} / ${f1(s.med)} / ${f1(s.max)}` : '—');

const rows: string[] = [];
rows.push(
  '| Lượt | Chế độ | Pool PgBouncer | Pod | VU (RATE) | Giai đoạn | Request | Thành công/giây | Lỗi | Lỗi theo loại | p50 ok | p95 ok | p99 ok | Kết nối thật min/med/max | PSS PG med/max (MB) | Chờ PgBouncer TB (ms) | maxwait max (ms) | Từ chối trong log PG | Readiness lỗi / khởi động lại | CPU VM bận med | Load VM / host med |',
);
rows.push('|' + '---|'.repeat(21));

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.run.json')).sort()) {
  const r = JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8'));
  const a = r.aggregates;
  const phases = Object.entries(r.k6 as Record<string, Phase>).filter(([p]) => p !== 'warmup');
  const stepSeconds: number = r.stepSeconds ?? r.durationS;
  for (const [p, ph] of phases) {
    const ok = ph.requests * (1 - ph.failedRate);
    const pods = r.scaleSteps.length > 1 ? r.scaleSteps[Number(p.slice(1))] : r.scaleSteps[0];
    rows.push(
      [
        '',
        r.name,
        r.mode,
        r.mode === 'sau' ? (r.poolerDefaultPoolSize ?? []).join('+') || '—' : '—',
        pods,
        `${r.scaleSteps.length > 1 ? pods * r.vusPerPod : (r.vus ?? pods * r.vusPerPod)}${r.rate ? ` (${r.rate}/s)` : ''}`,
        p,
        ph.requests.toLocaleString('vi-VN'),
        f1(ok / stepSeconds),
        `${f2(ph.failedRate * 100)} %`,
        Object.entries(ph.errorsByKind)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || '—',
        f1(ph.okLatencyMs.med),
        f1(ph.okLatencyMs.p95),
        f1(ph.okLatencyMs.p99),
        range(a.appConnections),
        a.postgresPssMb ? `${f1(a.postgresPssMb.med)} / ${f1(a.postgresPssMb.max)}` : '—',
        f2(a.poolerAvgWaitMsPerXact),
        f1(a.poolerMaxwaitMs?.max),
        `${a.postgresRejections.tooManyClients + a.postgresRejections.reservedForSuperuser}`,
        `${r.fleet.readinessFailed} / ${r.fleet.restarts}`,
        a.vmCpuBusyPct ? `${f1(a.vmCpuBusyPct.med)} %` : '—',
        `${f1(a.vmLoad1?.med)} / ${f1(a.hostLoad1?.med)}`,
        '',
      ].join(' | ').trim(),
    );
  }
}
console.log(rows.join('\n'));
