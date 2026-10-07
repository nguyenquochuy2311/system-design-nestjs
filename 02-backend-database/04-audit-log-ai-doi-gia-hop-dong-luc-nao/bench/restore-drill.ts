// Diễn tập "xóa nhầm hợp đồng đang có hồ sơ bồi thường" qua route Fastify (app.inject):
//   sau   : xóa mềm, 50 thay đổi khác của người khác xảy ra sau đó, rồi tra nhật ký "ai xóa, lúc nào" và khôi phục.
//           Đo: thời gian lệnh khôi phục, và thời gian tra nhật ký + khôi phục; kiểm hồ sơ bồi thường và 50 thay đổi kia.
//   truoc : xóa cứng; đếm hồ sơ bồi thường còn lại và xem DB còn gì để khôi phục.
// Ví dụ: RESULTS_DIR=bench/results/main ITERATIONS=20 pnpm bench:restore
import { buildApp } from '../src/app';
import { createDb } from '../src/shared/db';
import { addClaim } from '../src/sau/contract.repository';
import { rowHistory } from '../src/sau/audit-query';
import type { Contract } from '../src/shared/contract';
import { median, quantile, round, save } from './lib';

const ITERATIONS = Number(process.env.ITERATIONS ?? 20);
const OTHER_CHANGES = Number(process.env.OTHER_CHANGES ?? 50);

const db = createDb();
const app = buildApp(db);
const json = (r: { body: string }) => JSON.parse(r.body);

async function create(mode: 'truoc' | 'sau', i: number): Promise<Contract> {
  const res = await app.inject({
    method: 'POST',
    url: `/contracts?mode=${mode}`,
    headers: { 'x-user': 'nv-ban-hang' },
    payload: {
      code: `DRILL-${mode}-${Date.now()}-${i}`,
      customerName: 'Công ty Cổ phần Thép Phương Nam',
      product: 'Tài sản',
      premium: 120_000_000,
      sumInsured: 80_000_000_000,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    },
  });
  if (res.statusCode !== 201) throw new Error(`tạo hợp đồng: ${res.statusCode} ${res.body}`);
  return json(res);
}

const sau: Record<string, unknown>[] = [];
const truoc: Record<string, unknown>[] = [];
try {
  for (let i = 0; i < ITERATIONS; i++) {
    // ---- sau ----
    const c = await create('sau', i);
    await addClaim(db, { userId: 'nv-boi-thuong' }, c.id, 300_000_000);
    await addClaim(db, { userId: 'nv-boi-thuong' }, c.id, 45_000_000);
    await app.inject({ method: 'PATCH', url: `/contracts/${c.id}`, headers: { 'x-user': 'nv-tham-dinh' }, payload: { premium: 95_000_000 } });
    await app.inject({ method: 'DELETE', url: `/contracts/${c.id}`, headers: { 'x-user': 'nv-xoa-nham' }, payload: { reason: 'Tưởng hợp đồng trùng' } });

    const others = Array.from({ length: OTHER_CHANGES }, (_, k) => 1 + ((i * OTHER_CHANGES + k) * 613) % 40000);
    const expected = new Map<number, number>();
    for (const id of others) {
      const premium = 30_000_000 + ((id * 7) % 100) * 1_000_000 + i;
      const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}`, headers: { 'x-user': `nv-${id % 300}` }, payload: { premium } });
      if (res.statusCode === 200) expected.set(id, premium);
    }

    const t0 = performance.now();
    const who = (await rowHistory(db, 'contracts', c.id)).filter((h) => h.action === 'SOFT_DELETE').at(-1)!;
    const t1 = performance.now();
    const restored = await app.inject({ method: 'POST', url: `/contracts/${c.id}/restore`, headers: { 'x-user': 'truong-phong' }, payload: { reason: 'Xóa nhầm' } });
    const t2 = performance.now();

    const after = await app.inject({ method: 'GET', url: `/contracts/${c.id}` });
    const claims = await db.selectFrom('claims').select('id').where('contract_id', '=', c.id).execute();
    let othersKept = 0;
    for (const [id, premium] of expected) {
      const r = await app.inject({ method: 'GET', url: `/contracts/${id}` });
      if (r.statusCode === 200 && json(r).premium === premium) othersKept++;
    }
    sau.push({
      contractId: c.id,
      deletedBy: who.actor,
      deletedReason: who.reason,
      restoreStatus: restored.statusCode,
      restoreMs: round(t2 - t1, 3),
      lookupAndRestoreMs: round(t2 - t0, 3),
      visibleAfter: after.statusCode === 200,
      premiumAfter: after.statusCode === 200 ? json(after).premium : null,
      claimsAfter: claims.length,
      otherChanges: expected.size,
      otherChangesKept: othersKept,
    });

    // ---- truoc ----
    const t = await create('truoc', i);
    await db.withSchema('truoc').insertInto('claims').values([{ contract_id: t.id, amount: 300_000_000 }, { contract_id: t.id, amount: 45_000_000 }]).execute();
    const del = await app.inject({ method: 'DELETE', url: `/contracts/${t.id}?mode=truoc`, headers: { 'x-user': 'nv-xoa-nham' } });
    const gone = await app.inject({ method: 'GET', url: `/contracts/${t.id}?mode=truoc` });
    const tClaims = await db.withSchema('truoc').selectFrom('claims').select('id').where('contract_id', '=', t.id).execute();
    const tLog = await db.withSchema('truoc').selectFrom('app_audit_log').select('id').where('contract_id', '=', t.id).execute();
    truoc.push({ contractId: t.id, deleteStatus: del.statusCode, getAfter: gone.statusCode, claimsBefore: 2, claimsAfter: tClaims.length, historyRows: tLog.length });
  }
} finally {
  await app.close();
  await db.destroy();
}

const restoreMs = sau.map((s) => s.restoreMs as number);
const totalMs = sau.map((s) => s.lookupAndRestoreMs as number);
const result = {
  iterations: ITERATIONS,
  sau: {
    restoreMs: { median: round(median(restoreMs)), p95: round(quantile(restoreMs, 0.95)), max: round(Math.max(...restoreMs)) },
    lookupAndRestoreMs: { median: round(median(totalMs)), p95: round(quantile(totalMs, 0.95)), max: round(Math.max(...totalMs)) },
    allRestored: sau.every((s) => s.restoreStatus === 200 && s.visibleAfter && s.premiumAfter === 95_000_000),
    allClaimsKept: sau.every((s) => s.claimsAfter === 2),
    otherChanges: sau.reduce((a, s) => a + (s.otherChanges as number), 0),
    otherChangesKept: sau.reduce((a, s) => a + (s.otherChangesKept as number), 0),
    deletedByFoundInLog: sau.every((s) => s.deletedBy === 'nv-xoa-nham'),
  },
  truoc: {
    claimsBefore: truoc.length * 2,
    claimsAfter: truoc.reduce((a, s) => a + (s.claimsAfter as number), 0),
    contractsStillReadable: truoc.filter((s) => s.getAfter === 200).length,
    historyRows: truoc.reduce((a, s) => a + (s.historyRows as number), 0),
  },
  runs: { sau, truoc },
};
console.log(JSON.stringify({ ...result, runs: undefined }, null, 2));
console.log('Đã ghi', save('restore-drill.json', result));
