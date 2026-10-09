// (b) Consumer BullMQ có cùng trace_id với producer: một truy vấn Loki theo trace_id ra cả gateway → topup → ledger →
// (hàng đợi) → bank-adapter → ledger. Kiểm trên log thật trong Loki.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BANK_OK, BANK_TIMEOUT, fakePhone, lokiRange, byTraceQuery, parse, sendTopup, SERVICES, waitForJourney } from './support/stack.js';

const events = (lines: { line: string }[]) => lines.map((l) => String(parse(l.line)?.event));
const spanOf = (lines: { service: string; line: string }[], service: string, event: string) =>
  lines.filter((l) => l.service === service && parse(l.line)?.event === event).map((l) => String(parse(l.line)?.span_id));

describe('(b) trace_id đi qua HTTP và qua hàng đợi BullMQ', () => {
  it('lần nạp lỗi ngân hàng: dòng có topup_id cùng MỘT trace_id; truy vấn trace_id ra đủ 4 service, có lỗi của bank-adapter', async () => {
    const start = Date.now() - 2000;
    const { topup_id } = await sendTopup({ phone: fakePhone(41), amount: 2_041_000, bank: BANK_TIMEOUT });
    const j = await waitForJourney(topup_id, start);
    expect(j.traceIds).toHaveLength(1);
    expect(new Set(j.journey.map((l) => l.service))).toEqual(new Set(SERVICES));
    expect(events(j.journey)).toEqual(
      expect.arrayContaining(['topup.received', 'topup.created', 'ledger.entry_pending', 'topup.enqueued', 'bank.charge_started', 'bank.charge_failed', 'ledger.entry_reversed', 'topup.accepted']),
    );
    // Dòng của bank-adapter KHÔNG có topup_id (worker chỉ biết job) — chỉ nối được nhờ trace_id.
    const bank = j.journey.filter((l) => l.service === 'bank-adapter');
    expect(bank.length).toBeGreaterThanOrEqual(2);
    expect(bank.every((l) => parse(l.line)?.topup_id === undefined)).toBe(true);
    // Consumer là span con (span_id khác producer), không phải trace mới.
    const consumer = spanOf(j.journey, 'bank-adapter', 'bank.charge_started')[0];
    const producer = spanOf(j.journey, 'topup', 'topup.enqueued')[0];
    expect(consumer).toMatch(/^[0-9a-f]{16}$/);
    expect(consumer).not.toBe(producer);
  });

  it('traceparent do client gửi được giữ nguyên tới bank-adapter và ledger (không service nào tự tạo id mới)', async () => {
    const start = Date.now() - 2000;
    const traceId = randomBytes(16).toString('hex');
    const traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
    const { topup_id } = await sendTopup({ phone: fakePhone(42), amount: 2_042_000, bank: BANK_OK, traceparent });
    const j = await waitForJourney(topup_id, start);
    expect(j.traceId).toBe(traceId);
    expect(new Set(j.journey.map((l) => l.service))).toEqual(new Set(SERVICES));
    expect(events(j.journey)).toEqual(expect.arrayContaining(['bank.charge_succeeded', 'ledger.entry_confirmed']));
  });

  it('20 lần nạp đồng thời: mỗi topup_id đúng một trace_id riêng, mỗi trace đủ 4 service (context không lẫn giữa request)', async () => {
    const start = Date.now() - 2000;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => sendTopup({ phone: fakePhone(50 + (i % 3)), amount: 3_000_000 + i * 1000, bank: i % 2 ? BANK_TIMEOUT : BANK_OK })),
    );
    const journeys = [];
    for (const r of results) journeys.push(await waitForJourney(r.topup_id, start));
    expect(journeys.every((j) => j.traceIds.length === 1)).toBe(true);
    expect(new Set(journeys.map((j) => j.traceId)).size).toBe(20);
    for (const j of journeys) {
      expect(new Set(j.journey.map((l) => l.service))).toEqual(new Set(SERVICES));
      // Dòng ledger trong trace phải đúng topup của trace đó (không dính dòng của request khác).
      const ledgerTopups = new Set(j.journey.filter((l) => l.service === 'ledger').map((l) => parse(l.line)?.topup_id));
      expect([...ledgerTopups]).toEqual([j.own[0] && parse(j.own[0].line)?.topup_id]);
    }
    // Trace lấy lại từ Loki theo trace_id có đúng số dòng khi hỏi lại (không phụ thuộc thứ tự).
    const again = await lokiRange(byTraceQuery(journeys[0]!.traceId!), start);
    expect(again.length).toBe(journeys[0]!.journey.length);
  });
});
