// Địa chỉ của stack (cổng theo bảng cổng của lab) và hàm gọi gateway, Loki, Grafana, stdout container cho test và bench.
import { spawn } from 'node:child_process';

export const URLS = {
  gateway: process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100',
  loki: process.env.LOKI_URL ?? 'http://127.0.0.1:53100',
  grafana: process.env.GRAFANA_URL ?? 'http://127.0.0.1:53000',
};

export const SERVICES = ['gateway', 'topup', 'bank-adapter', 'ledger'] as const;
export const ALL_SERVICES_SELECTOR = '{service_name=~"gateway|topup|bank-adapter|ledger"}';

// Dữ liệu TỔNG HỢP: dải số 09000000xx và số thẻ thử nghiệm công khai của Visa/Mastercard (qua Luhn, không phải thẻ thật).
export const fakePhone = (i: number) => `09000000${String(i % 100).padStart(2, '0')}`;
export const TEST_CARDS = ['4111111111111111', '5555555555554444'] as const;
export const BANK_OK = 'SIMBANK_OK';
export const BANK_TIMEOUT = 'SIMBANK_TIMEOUT';

export interface TopupInput {
  phone: string;
  amount: number;
  bank: string;
  card?: string;
  traceparent?: string;
  /** Số thứ hai lồng sâu trong body (customer.contact.phone) và header x-msisdn dạng +84 — dùng cho test che dữ liệu. */
  contactPhone?: string;
  msisdn?: string;
}

export function topupBody(t: TopupInput) {
  return {
    customer: { phone: t.phone, name: 'Khach Tong Hop', contact: { phone: t.contactPhone ?? t.phone } },
    amount: t.amount,
    bank_code: t.bank,
    payment: { card: { number: t.card ?? TEST_CARDS[0], holder: 'KHACH TONG HOP', cvv: '123' } },
  };
}

export async function sendTopup(t: TopupInput): Promise<{ status: number; topup_id: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: 'Bearer lab-token-gia' };
  if (t.traceparent) headers.traceparent = t.traceparent;
  if (t.msisdn) headers['x-msisdn'] = t.msisdn;
  const res = await fetch(`${URLS.gateway}/topups`, { method: 'POST', headers, body: JSON.stringify(topupBody(t)) });
  const body = (await res.json()) as { topup_id?: string };
  if (!body.topup_id) throw new Error(`gateway trả ${res.status} không có topup_id: ${JSON.stringify(body)}`);
  return { status: res.status, topup_id: body.topup_id };
}

export interface LokiLine {
  service: string;
  tsNs: bigint;
  line: string;
  /** Label của stream + structured metadata (trace_id, span_id, severity_text...) mà Loki trả kèm. */
  meta: Record<string, string>;
}

/** Truy vấn log (query_range), trả mọi dòng theo thứ tự thời gian. `startMs`/`endMs` là mili giây Unix. */
export async function lokiRange(query: string, startMs: number, endMs = Date.now() + 1000, limit = 5000): Promise<LokiLine[]> {
  const params = new URLSearchParams({
    query,
    start: `${BigInt(Math.floor(startMs)) * 1_000_000n}`,
    end: `${BigInt(Math.floor(endMs)) * 1_000_000n}`,
    limit: String(limit),
    direction: 'forward',
  });
  const res = await fetch(`${URLS.loki}/loki/api/v1/query_range?${params}`);
  if (!res.ok) throw new Error(`Loki ${res.status} cho ${query}: ${await res.text()}`);
  const body = (await res.json()) as {
    status: string;
    data: { resultType: string; result: { stream: Record<string, string>; values: [string, string][] }[] };
  };
  if (body.status !== 'success') throw new Error(`Loki lỗi cho ${query}: ${JSON.stringify(body)}`);
  if (body.data.resultType !== 'streams') throw new Error(`cần streams, nhận ${body.data.resultType}`);
  const lines = body.data.result.flatMap((s) =>
    s.values.map(([ts, line]) => ({ service: s.stream.service_name ?? '', tsNs: BigInt(ts), line, meta: s.stream })),
  );
  return lines.sort((a, b) => (a.tsNs < b.tsNs ? -1 : a.tsNs > b.tsNs ? 1 : 0));
}

/** Truy vấn metric của LogQL (count_over_time...) tại một thời điểm; trả tổng các giá trị. */
export async function lokiInstantSum(query: string): Promise<number> {
  const res = await fetch(`${URLS.loki}/loki/api/v1/query?${new URLSearchParams({ query })}`);
  if (!res.ok) throw new Error(`Loki ${res.status} cho ${query}: ${await res.text()}`);
  const body = (await res.json()) as { status: string; data: { result: { value: [number, string] }[] } };
  if (body.status !== 'success') throw new Error(`Loki lỗi cho ${query}: ${JSON.stringify(body)}`);
  return body.data.result.reduce((s, r) => s + Number(r.value[1]), 0);
}

/** [PATTERN] Truy vấn người trực dùng: từ topup_id (chăm sóc khách hàng gửi) → các dòng có topup_id đó. */
export const byTopupQuery = (topupId: string) => `${ALL_SERVICES_SELECTOR} |= "${topupId}" | json | topup_id="${topupId}"`;
/** [PATTERN] Toàn bộ hành trình: lọc theo trace_id (structured metadata từ bản ghi OTLP, không cần `| json`). */
export const byTraceQuery = (traceId: string) => `${ALL_SERVICES_SELECTOR} | trace_id="${traceId}"`;

export const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/** Chờ tới khi `check` trả giá trị khác undefined, hỏi lại mỗi 250 ms. */
export async function waitFor<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = Number(process.env.TEST_WAIT_MS ?? 30_000)): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v !== undefined) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`hết ${timeoutMs} ms vẫn chưa thấy: ${what}${last ? ` (lỗi cuối: ${String(last)})` : ''}`);
}

/**
 * Chờ hành trình của một lần nạp vào Loki đủ: ledger đã ghi dòng cuối (xác nhận/đảo bút toán). Trả trace_id lấy từ các dòng
 * có topup_id (gateway, topup, ledger) và mọi dòng của trace đó.
 */
export async function waitForJourney(topupId: string, startMs: number) {
  return waitFor(`hành trình của ${topupId} trong Loki`, async () => {
    const own = await lokiRange(byTopupQuery(topupId), startMs);
    const done = own.some((l) => /"event":"ledger\.entry_(reversed|confirmed)"/.test(l.line));
    if (!done) return undefined;
    const traceIds = [...new Set(own.map((l) => String(parse(l.line)?.trace_id ?? '')))];
    const traceId = traceIds[0];
    const journey = traceIds.length === 1 && traceId ? await lokiRange(byTraceQuery(traceId), startMs) : [];
    return { own, traceIds, traceId, journey };
  });
}

/** stdout THẬT của container (Docker giữ, `docker compose logs`) từ một thời điểm, theo từng service. */
export async function stdoutLines(sinceMs: number, services: readonly string[] = SERVICES): Promise<{ service: string; line: string }[]> {
  const out: { service: string; line: string }[] = [];
  for (const service of services) {
    const text = await runText('docker', ['compose', 'logs', '--no-color', '--no-log-prefix', '--since', new Date(sinceMs).toISOString(), service]);
    for (const line of text.split('\n')) if (line.trim()) out.push({ service, line });
  }
  return out;
}

export function runText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${cmd} ${args.join(' ')} → ${code}: ${stderr}`))));
  });
}

export const grafanaAuth = () =>
  `Basic ${Buffer.from(`admin:${process.env.GRAFANA_ADMIN_PASSWORD ?? ''}`).toString('base64')}`;
