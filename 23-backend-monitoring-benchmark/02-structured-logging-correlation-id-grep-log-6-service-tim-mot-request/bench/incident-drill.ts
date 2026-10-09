// Diễn tập sự cố "ngân hàng đã trừ tiền nhưng ví chưa cộng": 10 lần nạp lỗi ở bank-adapter (sau hàng đợi BullMQ) giữa
// tải nền 5 lần nạp/s thành công (20 số điện thoại tổng hợp). Chăm sóc khách hàng chỉ đưa topup_id + số điện thoại.
// Đo KHÁCH QUAN (không bấm giờ người thật), theo runbook cố định viết trước khi chạy (quy ước 23/01 điểm 8):
//  --mode truoc: runbook grep trên `docker compose logs` — đếm lệnh, số dòng phải đọc, số service ghép được, có thấy
//                nguyên nhân (dòng lỗi ngân hàng ĐÚNG của lần nạp đó) không, số dòng có dữ liệu cá nhân lộ ra.
//  --mode sau:   2 truy vấn LogQL (topup_id → trace_id → hành trình) — thời gian Loki trả lời, số service / 4, có lỗi.
// Cả hai: đếm dòng chứa số điện thoại/số thẻ trong TOÀN BỘ log của lượt (Loki và stdout), tỉ lệ dòng JSON và có trace_id.
// Chạy: pnpm bench:incident --mode truoc|sau [--out main]
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { findPii } from '../packages/logging/pii.js';
import {
  ALL_SERVICES_SELECTOR, BANK_OK, BANK_TIMEOUT, byTopupQuery, byTraceQuery, fakePhone, lokiRange, parse, sendTopup,
  SERVICES, stdoutLines, TEST_CARDS, waitFor,
} from '../test/support/stack.js';
import { appMode } from './lib/compose.js';
import { machineState, median, run, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({
  options: {
    mode: { type: 'string', default: 'sau' },
    out: { type: 'string', default: 'main' },
    incidents: { type: 'string', default: '10' },
  },
});
const mode = args.mode === 'truoc' ? 'truoc' : 'sau';
const OUT = `bench/results/${args.out}`;
mkdirSync(OUT, { recursive: true });

interface Incident { i: number; topup_id: string; phone: string; msisdn: string; amount: number; sentAt: number }

const msisdnOf = (phone: string) => `84${phone.slice(1)}`;

// ---------- Tạo sự cố ----------
async function generate(): Promise<{ incidents: Incident[]; background: number; startMs: number }> {
  await appMode(mode);
  const startMs = Date.now();
  let running = true;
  let background = 0;
  // Tải nền: 5 lần nạp/s, thành công, cùng dải 20 số điện thoại với các lần nạp lỗi (khách nạp nhiều lần trong ngày).
  const bg = (async () => {
    let n = 0;
    while (running) {
      n += 1;
      const phone = fakePhone(n % 20);
      void sendTopup({ phone, msisdn: msisdnOf(phone), amount: 100_000 * (1 + (n % 5)), bank: BANK_OK, card: TEST_CARDS[n % 2] })
        .then(() => background++)
        .catch(() => undefined);
      await sleep(200);
    }
  })();
  await sleep(3000);
  const incidents: Incident[] = [];
  for (let i = 0; i < Number(args.incidents); i++) {
    const phone = fakePhone((i * 3) % 20);
    const amount = 2_100_000 + i * 1000; // số tiền riêng cho từng sự cố: CHỈ bộ chấm điểm dùng để biết dòng nào đúng
    const sentAt = Date.now();
    const { topup_id } = await sendTopup({ phone, msisdn: msisdnOf(phone), amount, bank: BANK_TIMEOUT, card: TEST_CARDS[i % 2] });
    incidents.push({ i, topup_id, phone, msisdn: msisdnOf(phone), amount, sentAt });
    await sleep(2000);
  }
  await sleep(3000);
  running = false;
  await bg;
  await sleep(3000); // chờ job cuối và log cuối vào Loki
  return { incidents, background, startMs };
}

// ---------- Runbook "trước": grep trên docker compose logs ----------
// Viết cố định trước khi chạy. Mỗi bước là MỘT lệnh shell; "dòng phải đọc" = số dòng lệnh in ra.
//  1. topup:        grep -A6 <topup_id>                → thấy phone, số tiền và job_id (bản trước log object nhiều dòng)
//  2. ledger:       grep <topup_id>                    → bút toán chờ / đảo
//  3. bank-adapter: grep -B12 -A6 "job_id: '<N>'"       → khối "gọi ngân hàng" và khối lỗi (job_id nằm cuối khối lỗi)
//     không có job_id ở bước 1 → grep -A3 <số điện thoại>
//  4. gateway:      grep <topup_id>                    → dòng "topup đã nhận" (có topup_id, giờ địa phương)
//  5. gateway:      grep -B3 -A10 <msisdn>             → các khối "nhận yêu cầu" của số đó; chọn khối gần nhất trước
//                                                        dòng ở bước 4 (giờ Docker) — đếm số ứng viên trong ±3 s
async function sh(cmd: string) {
  const r = await run('/bin/sh', ['-c', cmd]);
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  return { cmd, lines };
}
// Dòng của `--timestamps`: "2026-10-09T05:05:11.176123456Z <nội dung>" — cắt về mili giây rồi parse.
const dockerTs = (line: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}/.test(line) ? Date.parse(`${line.slice(0, 23)}Z`) : NaN);

async function runbookTruoc(inc: Incident) {
  const steps: { cmd: string; lines: string[] }[] = [];
  const logs = (svc: string) => `docker compose logs --no-color --no-log-prefix --timestamps ${svc}`;
  const s1 = await sh(`${logs('topup')} | grep -A6 '${inc.topup_id}'`);
  steps.push(s1);
  const jobId = s1.lines.join('\n').match(/job_id: '(\d+)'/)?.[1];
  steps.push(await sh(`${logs('ledger')} | grep '${inc.topup_id}'`));
  const s3 = jobId
    ? await sh(`${logs('bank-adapter')} | grep -B12 -A6 "job_id: '${jobId}'"`)
    : await sh(`${logs('bank-adapter')} | grep -A3 '${inc.phone}'`);
  steps.push(s3);
  const s4 = await sh(`${logs('gateway')} | grep '${inc.topup_id}'`);
  steps.push(s4);
  const s5 = await sh(`${logs('gateway')} | grep -B3 -A10 '${inc.msisdn}'`);
  steps.push(s5);

  // Chấm điểm (bộ chấm biết số tiền đúng của sự cố; runbook thì không dùng số tiền).
  const amountStr = String(inc.amount);
  const errorLines = s3.lines.filter((l) => /timeout sau 3000ms/.test(l));
  const errorFoundCorrect = errorLines.some((l) => l.includes(`số tiền ${amountStr}`));
  const errorLinesOtherTopups = errorLines.filter((l) => !l.includes(`số tiền ${amountStr}`)).length;
  const acceptedAt = s4.lines.map(dockerTs).find((t) => !Number.isNaN(t));
  // Ứng viên "nhận yêu cầu" của cùng số điện thoại trong ±3 s quanh dòng "topup đã nhận".
  const receivedTs = s5.lines.filter((l) => /x-msisdn/.test(l)).map(dockerTs).filter((t) => !Number.isNaN(t));
  const candidates = acceptedAt === undefined ? receivedTs.length : receivedTs.filter((t) => Math.abs(t - acceptedAt) <= 3000).length;
  const services = {
    topup: s1.lines.some((l) => l.includes(inc.topup_id)),
    ledger: steps[1]!.lines.length > 0,
    'bank-adapter': s3.lines.length > 0,
    gateway: s4.lines.length > 0 || candidates > 0,
  };
  const all = steps.flatMap((s) => s.lines);
  return {
    topup_id: inc.topup_id,
    commands: steps.length,
    linesRead: all.length,
    perStep: steps.map((s) => ({ cmd: s.cmd.replace(/docker compose logs --no-color --no-log-prefix --timestamps /, 'logs '), lines: s.lines.length })),
    jobIdFound: Boolean(jobId),
    servicesFound: Object.values(services).filter(Boolean).length,
    services,
    errorFoundCorrect,
    errorLinesOtherTopups,
    gatewayReceivedCandidates: candidates,
    piiLinesShownToEngineer: all.filter((l) => findPii(l).length).length,
  };
}

// ---------- Runbook "sau": 2 truy vấn LogQL ----------
async function timed<T>(f: () => Promise<T>) {
  const t = performance.now();
  const v = await f();
  return { v, ms: Number((performance.now() - t).toFixed(1)) };
}

async function runbookSau(inc: Incident, startMs: number) {
  const q1 = await timed(() => lokiRange(byTopupQuery(inc.topup_id), startMs));
  const traceIds = [...new Set(q1.v.map((l) => String(parse(l.line)?.trace_id ?? '')))].filter(Boolean);
  const traceId = traceIds[0] ?? '';
  const q2 = await timed(() => lokiRange(byTraceQuery(traceId), startMs));
  // Cùng hành trình nhưng lọc chuỗi trên nội dung dòng (không dùng structured metadata) — để so thời gian.
  const q2line = await timed(() => lokiRange(`${ALL_SERVICES_SELECTOR} |= "${traceId}"`, startMs));
  const failed = q2.v.map((l) => parse(l.line)).filter((o) => o?.event === 'bank.charge_failed') as { err?: { message?: string } }[];
  return {
    topup_id: inc.topup_id,
    commands: 2,
    traceIdsForTopup: traceIds.length,
    q1Ms: q1.ms,
    q2Ms: q2.ms,
    q2LineFilterMs: q2line.ms,
    q2LineFilterLines: q2line.v.length,
    linesRead: q1.v.length + q2.v.length,
    servicesFound: new Set(q2.v.map((l) => l.service)).size,
    services: [...new Set(q2.v.map((l) => l.service))],
    errorFoundCorrect: failed.some((o) => o.err?.message?.includes(`số tiền ${inc.amount}`)),
    events: q2.v.map((l) => String(parse(l.line)?.event)),
  };
}

// ---------- Đếm toàn bộ log của lượt ----------
async function wholeLogStats(startMs: number) {
  const loki = await lokiRange(ALL_SERVICES_SELECTOR, startMs - 1000, Date.now() + 1000, 50_000);
  const stdout = await stdoutLines(startMs - 1000);
  const stats = (lines: { line: string }[]) => {
    const parsed = lines.map((l) => parse(l.line));
    const pii = lines.map((l) => findPii(l.line));
    return {
      lines: lines.length,
      bytes: lines.reduce((n, l) => n + Buffer.byteLength(l.line) + 1, 0),
      json: parsed.filter(Boolean).length,
      withTraceId: parsed.filter((o) => typeof o?.trace_id === 'string').length,
      piiLines: pii.filter((h) => h.length).length,
      phoneLines: pii.filter((h) => h.some((x) => x.kind === 'phone')).length,
      cardLines: pii.filter((h) => h.some((x) => x.kind === 'card')).length,
    };
  };
  return { loki: stats(loki), stdout: stats(stdout), lokiTruncated: loki.length >= 50_000 };
}

const machine = await machineState();
const gaps = startSleepDetector();
console.log(`diễn tập ${mode}: ${args.incidents} sự cố + tải nền 5/s`);
const { incidents, background, startMs } = await generate();
await waitFor('log của lượt vào Loki', async () => ((await lokiRange(ALL_SERVICES_SELECTOR, Date.now() - 4000)).length > 0 ? true : undefined));
const perIncident: (Awaited<ReturnType<typeof runbookTruoc>> | Awaited<ReturnType<typeof runbookSau>>)[] = [];
for (const inc of incidents) perIncident.push(mode === 'truoc' ? await runbookTruoc(inc) : await runbookSau(inc, startMs - 1000));
const whole = await wholeLogStats(startMs);
const num = (k: string) => perIncident.map((x) => Number((x as unknown as Record<string, unknown>)[k] ?? 0));
const summary = {
  mode,
  machine,
  machineAfter: await machineState(),
  sleepGaps: gaps.stop(),
  incidents: incidents.length,
  backgroundTopups: background,
  commandsPerIncident: median(num('commands')),
  linesReadMedian: median(num('linesRead')),
  linesReadMinMax: [Math.min(...num('linesRead')), Math.max(...num('linesRead'))],
  completeJourneys: perIncident.filter((x) => x.servicesFound === SERVICES.length && x.errorFoundCorrect).length,
  servicesFound: num('servicesFound'),
  errorFoundCorrect: perIncident.filter((x) => x.errorFoundCorrect).length,
  ...(mode === 'sau'
    ? { q1MsMedian: median(num('q1Ms')), q2MsMedian: median(num('q2Ms')), q2LineFilterMsMedian: median(num('q2LineFilterMs')), q1MsMax: Math.max(...num('q1Ms')), q2MsMax: Math.max(...num('q2Ms')) }
    : { piiLinesShownMedian: median(num('piiLinesShownToEngineer')), ambiguousGateway: perIncident.filter((x) => Number((x as { gatewayReceivedCandidates?: number }).gatewayReceivedCandidates) > 1).length }),
  whole,
};
writeFileSync(`${OUT}/incident-${mode}.json`, JSON.stringify({ summary, perIncident }, null, 2));
console.log(JSON.stringify(summary, null, 2));
