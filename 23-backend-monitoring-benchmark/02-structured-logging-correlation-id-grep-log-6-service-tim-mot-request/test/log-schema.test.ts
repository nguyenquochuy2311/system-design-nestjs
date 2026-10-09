// (a) Mọi dòng log là JSON theo schema cố định — kiểm trên log THẬT: dòng đã vào Loki và stdout của 4 container.
import { beforeAll, describe, expect, it } from 'vitest';
import { REQUIRED_FIELDS } from '../packages/logging/index.js';
import {
  ALL_SERVICES_SELECTOR, BANK_OK, BANK_TIMEOUT, fakePhone, lokiInstantSum, lokiRange, parse, sendTopup, SERVICES,
  stdoutLines, URLS, waitForJourney, type LokiLine,
} from './support/stack.js';

const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Lỗi schema của một dòng (rỗng = đạt). Dòng sinh trong request/job (mọi event trừ service.started) phải có trace. */
function schemaErrors(line: string, service: string): string[] {
  const o = parse(line);
  if (!o) return ['không phải JSON object'];
  const errs: string[] = [];
  for (const f of REQUIRED_FIELDS) if (typeof o[f] !== 'string' || o[f] === '') errs.push(`thiếu/không phải chuỗi: ${f}`);
  if (typeof o.timestamp === 'string' && !ISO_UTC.test(o.timestamp)) errs.push(`timestamp không phải ISO-8601 UTC: ${o.timestamp}`);
  if (typeof o.level === 'string' && !LEVELS.has(o.level)) errs.push(`level lạ: ${o.level}`);
  if (o.service !== service) errs.push(`service=${String(o.service)} khác ${service}`);
  if (o.event !== 'service.started') {
    if (typeof o.trace_id !== 'string' || !/^[0-9a-f]{32}$/.test(o.trace_id)) errs.push('trace_id không phải 32 hex');
    if (typeof o.span_id !== 'string' || !/^[0-9a-f]{16}$/.test(o.span_id)) errs.push('span_id không phải 16 hex');
  }
  return errs;
}

describe('(a) schema log chung cho mọi service', () => {
  const start = Date.now();
  let loki: LokiLine[] = [];

  beforeAll(async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await sendTopup({ phone: fakePhone(30 + i), amount: 1_000_000 + i * 1000, bank: i % 2 ? BANK_TIMEOUT : BANK_OK });
      ids.push(r.topup_id);
    }
    for (const id of ids) await waitForJourney(id, start - 2000);
    loki = await lokiRange(ALL_SERVICES_SELECTOR, start - 2000);
  });

  it('có log của cả 4 service trong Loki cho 6 lần nạp (≥ 8 dòng mỗi lần)', () => {
    expect(new Set(loki.map((l) => l.service))).toEqual(new Set(SERVICES));
    expect(loki.length).toBeGreaterThanOrEqual(6 * 8);
  });

  it('mọi dòng trong Loki là JSON có đủ trường bắt buộc, đúng kiểu, có trace_id/span_id', () => {
    const bad = loki.map((l) => ({ service: l.service, errs: schemaErrors(l.line, l.service), line: l.line.slice(0, 160) })).filter((x) => x.errs.length);
    expect(bad).toEqual([]);
  });

  it('stdout thật của 4 container (docker compose logs) cũng đúng schema — không chỉ phần đã vào Loki', async () => {
    const lines = await stdoutLines(start - 2000);
    expect(lines.length).toBeGreaterThanOrEqual(6 * 8);
    const bad = lines.map((l) => ({ service: l.service, errs: schemaErrors(l.line, l.service), line: l.line.slice(0, 160) })).filter((x) => x.errs.length);
    expect(bad).toEqual([]);
  });

  it('LogQL: 0 dòng lỗi parse JSON (`| json | __error__!=""`) trên tổng số dòng của cửa sổ', async () => {
    const win = `${Math.ceil((Date.now() - start) / 1000) + 5}s`;
    const total = await lokiInstantSum(`sum(count_over_time(${ALL_SERVICES_SELECTOR}[${win}]))`);
    const parseErrors = await lokiInstantSum(`sum(count_over_time(${ALL_SERVICES_SELECTOR} | json | __error__!="" [${win}]))`);
    expect(total).toBeGreaterThanOrEqual(48);
    expect(parseErrors).toBe(0);
  });

  it('label của Loki ít và ổn định: chỉ service_name; trace_id, topup_id không phải label (structured metadata / nội dung)', async () => {
    const res = (await (await fetch(`${URLS.loki}/loki/api/v1/labels`)).json()) as { data: string[] };
    // Bỏ label nội bộ của Loki (`__stream_shard__`: Loki tự chia stream khi một stream ghi quá nhanh, gặp sau lượt đo tải).
    expect(res.data.filter((l) => !l.startsWith('__'))).toEqual(['service_name']);
    const values = (await (await fetch(`${URLS.loki}/loki/api/v1/label/service_name/values`)).json()) as { data: string[] };
    expect(new Set(values.data)).toEqual(new Set(SERVICES));
    // trace_id có trong structured metadata của mỗi dòng (Collector đọc vào TraceId của bản ghi OTLP).
    expect(loki.every((l) => /^[0-9a-f]{32}$/.test(l.meta.trace_id ?? '') || parse(l.line)?.event === 'service.started')).toBe(true);
  });
});
