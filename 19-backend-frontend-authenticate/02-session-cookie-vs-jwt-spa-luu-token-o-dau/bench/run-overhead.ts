// Đo overhead tra Redis mỗi request: p95 của /sau/me (session) so với /truoc/me (JWT). 3 vòng, ĐẢO thứ tự giữa
// các vòng; hai mô hình: arrival (200 req/s) và closed (1 VU nối tiếp — sạch hơn cho overhead nhỏ, nhật ký 01/03 điểm 5).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from '../src/shared/password';
import { SEED_USERS } from '../src/shared/seed-users';
import { API, benchSecrets, k6, LAB_DIR, machineState, median, startApi, writeResult } from './lib/lab';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/crm';
const ORIGIN = 'http://localhost:3200';
const DURATION = process.env.DURATION || '30s';
const ROUNDS = Number(process.env.ROUNDS || 3);
const tmp = mkdtempSync(join(tmpdir(), 'k6-overhead-'));

async function ensureSeed(pool: Pool) {
  await pool.query('DELETE FROM notes');
  await pool.query('DELETE FROM users');
  for (const u of SEED_USERS)
    await pool.query('INSERT INTO users (email, display_name, password_hash, locked) VALUES ($1,$2,$3,false)', [u.email, u.displayName, hashPassword(u.password)]);
}

interface Summary {
  p95: number;
  med: number;
  avg: number;
  reqs: number;
  checksRate: number;
  dropped: number;
}

async function runK6(endpoint: 'truoc' | 'sau', model: 'arrival' | 'closed', env: Record<string, string>): Promise<Summary> {
  const out = join(tmp, `${endpoint}-${model}-${Date.now()}.json`);
  const res = await k6([
    'run',
    '--quiet',
    'bench/session-overhead.k6.js',
    ...['-e', `ENDPOINT=${endpoint}`, '-e', `MODEL=${model}`, '-e', `DURATION=${DURATION}`, '-e', `SUMMARY_OUT=${out}`],
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  ]);
  if (res.status !== 0) throw new Error(`k6 thoát mã ${res.status} (${endpoint}/${model})`);
  const data = JSON.parse(readFileSync(out, 'utf8'));
  const d = data.metrics.http_req_duration.values;
  return {
    p95: Number(d['p(95)'].toFixed(2)),
    med: Number(d['med'].toFixed(2)),
    avg: Number(d['avg'].toFixed(2)),
    reqs: data.metrics.http_reqs?.values.count ?? 0,
    checksRate: data.metrics.checks?.values.rate ?? 1,
    dropped: data.metrics.dropped_iterations?.values.count ?? 0,
  };
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  await ensureSeed(pool);
  const api = await startApi(benchSecrets());
  const results: Record<string, unknown> = { at: new Date().toISOString(), duration: DURATION, rounds: ROUNDS, machineStart: machineState(), rows: [] as unknown[] };

  try {
    // Lấy token JWT (truoc) và cookie phiên (sau) từ CHÍNH tiến trình API này.
    const alice = SEED_USERS[0]!;
    const tok = (await (await fetch(`${API}/truoc/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: alice.email, password: alice.password }) })).json()) as { token: string };
    const loginRes = await fetch(`${API}/sau/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: alice.email, password: alice.password }) });
    const sid = loginRes.headers.getSetCookie().find((c) => c.startsWith('__Host-sid='))!.split(';')[0]!;
    const env = { TOKEN: tok.token, SID_COOKIE: sid };

    const rows: any[] = [];
    for (const model of ['closed', 'arrival'] as const) {
      for (let round = 1; round <= ROUNDS; round++) {
        const order: ('truoc' | 'sau')[] = round % 2 === 1 ? ['truoc', 'sau'] : ['sau', 'truoc'];
        const machine = machineState();
        const perEndpoint: Record<string, Summary> = {};
        for (const endpoint of order) perEndpoint[endpoint] = await runK6(endpoint, model, env);
        rows.push({ model, round, order, machine: { power: machine.power, load1: machine.load1, lidClosed: machine.lidClosed }, truoc: perEndpoint.truoc, sau: perEndpoint.sau });
        console.log(`[${model} vòng ${round}] truoc p95=${perEndpoint.truoc!.p95}ms · sau p95=${perEndpoint.sau!.p95}ms · delta=${(perEndpoint.sau!.p95 - perEndpoint.truoc!.p95).toFixed(2)}ms (load ${machine.load1})`);
      }
    }

    // Tổng hợp: trung vị p95 theo mô hình.
    const summary: Record<string, unknown> = {};
    for (const model of ['closed', 'arrival'] as const) {
      const r = rows.filter((x) => x.model === model);
      const truocP95 = r.map((x) => x.truoc.p95);
      const sauP95 = r.map((x) => x.sau.p95);
      summary[model] = {
        truoc_p95_median: median(truocP95),
        truoc_p95_range: [Math.min(...truocP95), Math.max(...truocP95)],
        sau_p95_median: median(sauP95),
        sau_p95_range: [Math.min(...sauP95), Math.max(...sauP95)],
        delta_p95_median: Number((median(sauP95) - median(truocP95)).toFixed(2)),
        delta_per_round: r.map((x) => Number((x.sau.p95 - x.truoc.p95).toFixed(2))),
      };
    }
    results.rows = rows;
    results.summary = summary;
    results.machineEnd = machineState();
    const file = writeResult('overhead.json', results);
    console.log('\n=== Tổng hợp ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Đã ghi ${file}`);
  } finally {
    await api.stop();
    await pool.end();
  }
}

void LAB_DIR;
await main();
