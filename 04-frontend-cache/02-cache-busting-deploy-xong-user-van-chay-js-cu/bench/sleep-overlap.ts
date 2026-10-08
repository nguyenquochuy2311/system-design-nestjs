/**
 * Khoảng máy ngủ (từ `pmset -g log`, đã lưu vào pmset-sleep.log) rơi vào từng lượt đo của thư mục kết quả.
 * Dùng cho các lượt chạy trước khi bench có bộ phát hiện máy ngủ.   RUN=main pnpm tsx bench/sleep-overlap.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resultsDir, writeJson } from './lib';

const dir = resultsDir();
const lines = readFileSync(join(dir, 'pmset-sleep.log'), 'utf8').split('\n').filter(Boolean);
const at = (l: string) => new Date(`${l.slice(0, 10)}T${l.slice(11, 19)}+07:00`).getTime();
const sleeps: { from: number; to: number }[] = [];
let open: number | null = null;
for (const l of lines) {
  if (/\+0700 Sleep\s+\t/.test(l)) open = at(l);
  else if (/\+0700 (DarkWake|Wake)\s+\t/.test(l) && open !== null) {
    sleeps.push({ from: open, to: at(l) });
    open = null;
  }
}
const iso = (t: number) => new Date(t).toTimeString().slice(0, 8);
const out: Record<string, unknown> = {};
for (const f of readdirSync(dir).filter((x) => /^(fleet|bytes)-.*\.json$/.test(x) && !/-(summary|cdn)\.json$/.test(x))) {
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { startedAt?: number; observations?: { at: number }[]; runs?: unknown[] };
  if (!raw.observations || !raw.startedAt) continue;
  const end = Math.max(...raw.observations.map((o) => o.at));
  const hits = sleeps.filter((s) => s.to > raw.startedAt! && s.from < end).map((s) => ({ from: iso(s.from), to: iso(s.to), seconds: (s.to - s.from) / 1000 }));
  out[f] = { start: iso(raw.startedAt), end: iso(end), sleeps: hits.length, sleepSeconds: hits.reduce((a, s) => a + s.seconds, 0), detail: hits };
}
out['tests.json + bytes-*.json'] = { note: 'chạy 23:43:07 – 23:45:04 (run.log); lần ngủ đầu tiên của đêm là 23:46:33 (Clamshell Sleep)', firstSleep: sleeps[0] ? iso(sleeps[0].from) : null };
if (existsSync(join(dir, 'run.log'))) out.runLog = 'xem mốc giờ từng bước trong run.log';
writeJson(join(dir, 'sleep-overlap.json'), out);
