// (c) Không dòng log nào (trong Loki và trên stdout) khớp regex số điện thoại VN hay số thẻ (Luhn) — kể cả số nằm trong
// header, body lồng nhau, err.message và stack. Đồng thời kiểm dữ liệu VẪN được log ở dạng đã che (test không đạt "giả"
// vì trường bị bỏ trống).
import { beforeAll, describe, expect, it } from 'vitest';
// Bộ nhận diện viết RIÊNG trong test, không import từ packages/logging: nếu test dùng chung regex với bộ che dữ liệu thì
// làm yếu regex sẽ làm mù cả hai và test xanh giả (người điều phối tái hiện khi kiểm chứng 23/02).
const PHONE_RE = /(?<![\w+])(?:\+?84|0)[ .-]?[35789](?:[ .-]?\d){8}(?!\w)/g;
const CARD_RE = /(?<!\w)\d(?:[ -]?\d){12,18}(?!\w)/g;
const luhn = (d: string) => [...d].reverse().reduce((s, c, i) => s + (i % 2 ? ((+c * 2) % 10) + Math.floor((+c * 2) / 10) : +c), 0) % 10 === 0;
function detectPii(line: string): { kind: string; value: string }[] {
  const hits = [...line.matchAll(PHONE_RE)].map((m) => ({ kind: 'phone', value: m[0] }));
  for (const m of line.matchAll(CARD_RE)) if (luhn(m[0].replace(/\D/g, ''))) hits.push({ kind: 'card', value: m[0] });
  return hits;
}
import { ALL_SERVICES_SELECTOR, BANK_TIMEOUT, BANK_OK, lokiRange, parse, sendTopup, stdoutLines, TEST_CARDS, waitForJourney, type LokiLine } from './support/stack.js';

describe('(c) không lộ số điện thoại, số thẻ trong log', () => {
  const start = Date.now() - 2000;
  let loki: LokiLine[] = [];
  let journeys: LokiLine[] = [];

  const cases = [
      // Số ở nhiều dạng viết: 0..., +84 có dấu cách, có dấu chấm; header x-msisdn 84...; số thứ hai lồng sâu trong body.
      { phone: '0900000061', contactPhone: '+84 900 000 062', msisdn: '84900000061', card: TEST_CARDS[0], bank: BANK_TIMEOUT },
      { phone: '0900.000.063', contactPhone: '0900000064', msisdn: '+84900000063', card: TEST_CARDS[1], bank: BANK_TIMEOUT },
      { phone: '0900000065', contactPhone: '0900000066', msisdn: '84900000065', card: TEST_CARDS[1], bank: BANK_OK },
  ];
  // Mọi giá trị đã gửi, ở dạng gốc và dạng chỉ còn chữ số: không được xuất hiện nguyên vẹn trong bất kỳ dòng log nào.
  const sent = [...new Set(cases.flatMap((c) => [c.phone, c.contactPhone, c.msisdn, c.card]).flatMap((v) => [v, v.replace(/\D/g, '')]))];
  const leaks = (line: string) => [...detectPii(line), ...sent.filter((v) => line.includes(v)).map((v) => ({ kind: 'sent-value', value: v }))];

  beforeAll(async () => {
    const ids = [];
    for (const [i, c] of cases.entries()) ids.push((await sendTopup({ ...c, amount: 5_000_000 + i * 1000 })).topup_id);
    for (const id of ids) journeys.push(...(await waitForJourney(id, start)).journey);
    loki = await lokiRange(ALL_SERVICES_SELECTOR, start);
  });

  it('dữ liệu cá nhân có đi vào logger (đã che): header, body lồng nhau, số thẻ, err.message', () => {
    const received = journeys.map((l) => parse(l.line)).filter((o) => o?.event === 'topup.received');
    expect(received.length).toBeGreaterThanOrEqual(3);
    const r = received[0] as { req: { headers: Record<string, string>; body: { customer: { phone: string; contact: { phone: string } }; payment: { card: { number: string; cvv: string } } } } };
    expect(r.req.headers['x-msisdn']).toMatch(/^\*\*\*\d{3}$/);
    expect(r.req.headers.authorization).toBe('[REDACTED]');
    expect(r.req.body.customer.phone).toMatch(/^\*\*\*\d{3}$/);
    expect(r.req.body.customer.contact.phone).toMatch(/^\*\*\*\d{3}$/);
    expect(r.req.body.payment.card.number).toMatch(/^\*{4}\d{4}$/);
    expect(r.req.body.payment.card.cvv).toBe('[REDACTED]');
    const failed = journeys.map((l) => parse(l.line)).filter((o) => o?.event === 'bank.charge_failed') as { err: { message: string; stack: string } }[];
    expect(failed.length).toBeGreaterThanOrEqual(2);
    // err.message gốc: "SIMBANK_TIMEOUT timeout sau 3000ms (thuê bao 09..., thẻ 4111..., số tiền ...)"
    expect(failed[0]!.err.message).toMatch(/thuê bao \*\*\*\d{3}, thẻ \*{4}\d{4}/);
    expect(failed[0]!.err.stack).toContain('thuê bao ***');
  });

  it('không dòng nào trong Loki khớp regex số điện thoại VN hay số thẻ (Luhn)', () => {
    const hits = loki.flatMap((l) => leaks(l.line).map((h) => ({ service: l.service, ...h, line: l.line.slice(0, 200) })));
    expect(hits).toEqual([]);
  });

  it('stdout thật của 4 container cũng không có số điện thoại hay số thẻ', async () => {
    const lines = await stdoutLines(start);
    expect(lines.length).toBeGreaterThan(0);
    const hits = lines.flatMap((l) => leaks(l.line).map((h) => ({ service: l.service, ...h, line: l.line.slice(0, 200) })));
    expect(hits).toEqual([]);
  });
});
