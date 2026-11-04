import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appConnections, connectAdmin, Crm, REPORT_SECONDS, resetData, sleep, waitUntil } from './support/stack';

const REPORT_MS = REPORT_SECONDS * 1_000;

describe('Khách lớn chạy báo cáo cùng lúc với khách nhỏ ghi chú', () => {
  let admin: pg.Pool;
  let crm: Crm;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(() => resetData(admin));
  afterEach(() => crm.stop());

  it('trước: báo cáo chiếm hết pool, ghi chú của khách nhỏ phải chờ', async () => {
    crm = await new Crm({ mode: 'truoc' }).start();

    const reports = Array.from({ length: 40 }, () => crm.report('T-1'));
    await sleep(50);
    const note = await crm.note('T-2');

    expect(note.status).toBe(201);
    expect(note.ms).toBeGreaterThan(REPORT_MS / 2);
    await Promise.all(reports);
  });

  // Nhiều tenant cùng chạy báo cáo: một tenant đã bị giới hạn 1 chỗ nên không đủ làm đầy pool báo cáo.
  it('sau: pool báo cáo đầy không làm chậm ghi chú', async () => {
    crm = await new Crm({ mode: 'sau' }).start();

    const reports = Array.from({ length: 40 }, (_, i) => crm.report(`T-${i + 100}`));
    await sleep(50);
    const notes = await Promise.all(Array.from({ length: 20 }, (_, i) => crm.note(`T-${i + 2}`)));

    expect(notes.every((note) => note.status === 201)).toBe(true);
    expect(Math.max(...notes.map((note) => note.ms))).toBeLessThan(REPORT_MS / 2);
    await Promise.all(reports);
  });

  it('sau: tổng kết nối không vượt tổng kích thước pool', async () => {
    crm = await new Crm({ mode: 'sau' }).start();
    let peak = 0;
    const load = [
      ...Array.from({ length: 30 }, (_, i) => crm.report(`T-${i + 1}`)),
      ...Array.from({ length: 100 }, (_, i) => crm.note(`T-${i + 2}`)),
    ];

    const sampling = (async () => {
      for (let i = 0; i < 20; i += 1) {
        peak = Math.max(peak, await appConnections(admin));
        await sleep(20);
      }
    })();
    await Promise.all([...load, sampling]);

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(18);
  });

  it('sau: xuất dữ liệu trả 202 ngay, worker làm với concurrency cố định', async () => {
    crm = await new Crm({ mode: 'sau' }).start();
    crm.startWorker();

    const replies = await Promise.all(Array.from({ length: 4 }, () => crm.requestExport('T-1')));

    expect(replies.every((reply) => reply.status === 202 && reply.ms < REPORT_MS)).toBe(true);
    await waitUntil(async () => {
      const { rows } = await admin.query("SELECT count(*)::int AS n FROM crm.exports WHERE status = 'DONE'");
      return rows[0].n === 4;
    }, 'mọi lần xuất xong');
  });

  it('trước: xuất dữ liệu giữ request tới khi xong', async () => {
    crm = await new Crm({ mode: 'truoc' }).start();

    const reply = await crm.requestExport('T-1');

    expect(reply.ms).toBeGreaterThanOrEqual(REPORT_MS);
  });
});
