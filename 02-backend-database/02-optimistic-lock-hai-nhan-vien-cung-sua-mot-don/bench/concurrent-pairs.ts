// Kịch bản "1.000 cặp sửa đồng thời" qua HTTP (API phải đang chạy: pnpm dev).
// Mỗi cặp: A và B cùng mở một vận đơn (cùng version) -> A đổi địa chỉ, B thêm ghi chú (form B vẫn mang địa chỉ cũ)
// -> hai lần lưu, lần lượt (TIMING=sequential) hoặc cùng lúc (TIMING=simultaneous) -> ai nhận 409 thì gộp ba phía
// và lưu lại với version mới (MERGE=true) -> đọc trạng thái cuối.
// "Lost update" = có một lần lưu đã được trả 200 nhưng thay đổi của nó không còn trong trạng thái cuối.
// Ví dụ: MODE=lww TIMING=sequential PAIRS=1000 NAME=pairs-lww-seq pnpm bench:pairs
import { mkdirSync, writeFileSync } from 'node:fs';
import { formOf, type Shipment, type ShipmentForm } from '../src/shared/shipment';
import { mergeShipmentForm } from '../src/sau/merge-shipment-form';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const MODE = process.env.MODE ?? 'version';
const TIMING = process.env.TIMING ?? 'sequential';
const PAIRS = Number(process.env.PAIRS ?? 1000);
const FIRST_ID = Number(process.env.FIRST_ID ?? 1);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const MERGE = (process.env.MERGE ?? 'true') === 'true';
const NAME = process.env.NAME ?? `pairs-${MODE}-${TIMING}`;
const RUN = Date.now().toString(36);

interface SaveResponse {
  status: number;
  body: Shipment | { error: string; current: Shipment };
}

async function open(id: number): Promise<Shipment> {
  const res = await fetch(`${BASE}/shipments/${id}`);
  if (res.status !== 200) throw new Error(`GET /shipments/${id} trả ${res.status}`);
  return (await res.json()) as Shipment;
}

async function save(id: number, user: string, form: ShipmentForm, version: number): Promise<SaveResponse> {
  const res = await fetch(`${BASE}/shipments/${id}?mode=${MODE}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-user': user },
    body: JSON.stringify({ ...form, version }),
  });
  if (res.status !== 200 && res.status !== 409) throw new Error(`PATCH /shipments/${id} (${user}) trả ${res.status}: ${await res.text()}`);
  return { status: res.status, body: (await res.json()) as SaveResponse['body'] };
}

const totals = { pairs: 0, sameVersionOnOpen: 0, firstTry200: 0, firstTry409: 0, bothFirstTry200: 0, mergedResaves: 0, unresolvedConflicts: 0, lostUpdatePairs: 0 };

/** Một người dùng: lưu; nếu bị 409 thì gộp ba phía rồi lưu lại một lần với version mới. Trả về true nếu thay đổi được ghi nhận. */
async function userSaves(id: number, user: string, base: Shipment, mine: ShipmentForm, res: SaveResponse): Promise<boolean> {
  if (res.status === 200) {
    totals.firstTry200++;
    return true;
  }
  totals.firstTry409++;
  if (!MERGE) return false;
  const { current } = res.body as { current: Shipment };
  const { merged, conflicts } = mergeShipmentForm(formOf(base), mine, formOf(current));
  if (conflicts.length > 0) {
    totals.unresolvedConflicts++;
    return false; // xung đột thật trên cùng một trường: phải để người dùng chọn
  }
  const again = await save(id, user, merged, current.version);
  if (again.status !== 200) throw new Error(`Lưu lại sau gộp vẫn 409 ở vận đơn ${id}`);
  totals.mergedResaves++;
  return true;
}

async function runPair(id: number): Promise<void> {
  const [a, b] = await Promise.all([open(id), open(id)]);
  totals.pairs++;
  if (a.version === b.version) totals.sameVersionOnOpen++;
  const mineA = { ...formOf(a), address: `Địa chỉ mới A ${RUN}-${id}` };
  const mineB = { ...formOf(b), note: `Ghi chú B ${RUN}-${id}` };

  let ackA: boolean;
  let ackB: boolean;
  if (TIMING === 'simultaneous') {
    const [ra, rb] = await Promise.all([save(id, 'A', mineA, a.version), save(id, 'B', mineB, b.version)]);
    if (ra.status === 200 && rb.status === 200) totals.bothFirstTry200++;
    [ackA, ackB] = await Promise.all([userSaves(id, 'A', a, mineA, ra), userSaves(id, 'B', b, mineB, rb)]);
  } else {
    ackA = await userSaves(id, 'A', a, mineA, await save(id, 'A', mineA, a.version));
    ackB = await userSaves(id, 'B', b, mineB, await save(id, 'B', mineB, b.version));
  }

  const final = await open(id);
  const lostA = ackA && final.address !== mineA.address;
  const lostB = ackB && final.note !== mineB.note;
  if (lostA || lostB) totals.lostUpdatePairs++;
}

const started = performance.now();
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < PAIRS) {
      const id = FIRST_ID + next++;
      await runPair(id);
    }
  }),
);
const seconds = (performance.now() - started) / 1000;

const out = {
  name: NAME,
  mode: MODE,
  timing: TIMING,
  merge: MERGE,
  ...totals,
  // Mỗi cặp là một lần ghi đè tiềm năng (hai form từ cùng version); 409 là lần ghi đè đó được báo cho người dùng.
  conflictReportedRate: totals.pairs ? totals.firstTry409 / totals.pairs : 0,
  lostUpdateRate: totals.pairs ? totals.lostUpdatePairs / totals.pairs : 0,
  seconds: Math.round(seconds * 10) / 10,
};
mkdirSync('bench/results', { recursive: true });
writeFileSync(`bench/results/${NAME}.json`, JSON.stringify(out, null, 2));
console.log(
  `== ${NAME} (mode=${MODE}, timing=${TIMING}, merge=${MERGE}) ${out.pairs} cặp trong ${out.seconds}s\n` +
    `cùng version khi mở: ${out.sameVersionOnOpen} · 200 lần đầu: ${out.firstTry200} · 409 lần đầu: ${out.firstTry409} · ` +
    `cả hai 200 cùng lúc: ${out.bothFirstTry200} · gộp và lưu lại: ${out.mergedResaves} · xung đột chưa gộp: ${out.unresolvedConflicts}\n` +
    `lost update: ${out.lostUpdatePairs}/${out.pairs} cặp (${Math.round(out.lostUpdateRate * 1000) / 10} %)`,
);
