/**
 * Script "KẺ TẤN CÔNG" offline: giả định đã có TOÀN BỘ bản dump (lộ DB), thử từ điển tổng hợp lên MỌI cột
 * còn mang dấu vết mật khẩu — cột MD5 cũ VÀ cột Argon2id. Chạy ở hai thời điểm để so trước/sau migration:
 *   - "Trước" (dump sau seed, chưa migrate): cột password_md5 còn → bẻ gần như tức thì.
 *   - "Sau"  (dump sau migrate:wrap): password_md5 đã xóa (NULL) → 0 qua MD5; chỉ còn Argon2id.
 *
 * Nhãn: tỷ lệ bẻ được phụ thuộc giả định phân phối mật khẩu user lab ("minh họa"); tốc độ thử và số bẻ được
 * trên dữ liệu lab ("đã đo"); thời gian bẻ Argon2id cho tài khoản chưa bẻ thật là "ngoại suy" (tốc độ verify
 * đã đo × vị trí mật khẩu trong từ điển — vị trí tính từ phân phối seed deterministic của chính lab).
 * Chạy: RUN=fix OUT_NAME=crack-truoc.json pnpm bench:crack   (đặt PASSWORD_PEPPER như khi migrate)
 */
import { createHash } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { createDb } from '../src/shared/db';
import { assignSeedPasswords, generateDictionary, type SeedUser } from './lib/dictionary.js';
import { machineState, median, percentile, startSleepDetector, writeResult } from './lib/env.js';

const pepperEnv = process.env.PASSWORD_PEPPER;
const PEPPER = pepperEnv ? Buffer.from(pepperEnv, 'utf8') : null;
const OUT_NAME = process.env.OUT_NAME ?? 'crack.json';
const VERIFY_SAMPLE = Number(process.env.VERIFY_SAMPLE ?? 64);
const NO_PEPPER_SAMPLE = Number(process.env.NO_PEPPER_SAMPLE ?? 50);
const REAL_CRACK_BUDGET = Number(process.env.REAL_CRACK_BUDGET ?? 400);

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

const db = createDb({ max: 4 });
const sleep = startSleepDetector();
const before = machineState();
try {
  const dict = generateDictionary();
  const dictIndex = new Map(dict.map((w, i) => [w, i] as const));

  // Dump = 10.000 user @lab.example (loại user bench/test khỏi phần minh họa).
  const users = await db
    .selectFrom('users')
    .select(['email', 'password_md5', 'password_hash', 'hash_version'])
    .where('email', 'like', '%@lab.example')
    .execute();
  const dump = users.length;
  // Phân phối mật khẩu seed là deterministic: dựng lại để biết mật khẩu và vị trí từ điển cho phần ngoại suy.
  const assign = new Map(assignSeedPasswords(dump, dict).map((u) => [u.email, u] as const));
  console.log(`Dump ${dump} user @lab.example. Từ điển tổng hợp ${dict.length} ứng viên. OUT=${OUT_NAME}\n`);

  // ───────── Tấn công cột MD5 trong dump ─────────
  const withMd5 = users.filter((u) => u.password_md5 !== null);
  const tHash0 = performance.now();
  for (const w of dict) md5(w);
  const md5HashSec = (performance.now() - tHash0) / 1000;
  const md5Map = new Map<string, string>();
  for (const w of dict) md5Map.set(md5(w), w);
  let md5Cracked = 0;
  for (const u of withMd5) if (md5Map.has(u.password_md5!)) md5Cracked++;
  const md5PerSec = dict.length / md5HashSec;
  const md5Result = {
    rowsWithMd5: withMd5.length,
    cracked: md5Cracked,
    crackedPctOfDump: Number(((md5Cracked / dump) * 100).toFixed(1)),
    candidatesPerSec: Math.round(md5PerSec),
  };
  console.log(`MD5 trong dump: ${withMd5.length}/${dump} dòng còn cột MD5; bẻ ${md5Cracked} (${md5Result.crackedPctOfDump}% toàn dump) trong ${md5HashSec.toFixed(2)} s.`);
  console.log(`   Tốc độ thử (băm md5 thuần, CPU 1 luồng): ~${(md5PerSec / 1e6).toFixed(1)} triệu ứng viên/giây (GPU thực tế: hàng tỷ/giây — minh họa).`);

  // ───────── Tấn công cột Argon2id trong dump ─────────
  const wrapped = users.filter((u) => u.password_hash !== null && u.hash_version === 1);
  let argon2: unknown = null;
  if (wrapped.length === 0) {
    console.log('Argon2id: dump chưa có cột hash Argon2id (chưa migrate). Bỏ phần Argon2id.\n');
  } else {
    const probe = wrapped[0]!.password_hash!;
    // (a) Tốc độ verify/giây (đã đo), có pepper (tình huống tệ nhất), ứng viên sai.
    const vt: number[] = [];
    for (let i = 0; i < VERIFY_SAMPLE; i++) {
      const s = performance.now();
      await verify(probe, md5(`khong-khop-${i}`), PEPPER ? { secret: PEPPER } : {});
      vt.push(performance.now() - s);
    }
    const verifyMs = median(vt);
    const verifyPerSec = 1000 / verifyMs;

    // Tập user dict (biết mật khẩu từ phân phối seed) để thử.
    const dictWrapped: { u: (typeof wrapped)[number]; a: SeedUser }[] = [];
    for (const u of wrapped) {
      const a = assign.get(u.email);
      if (a && a.inDict) dictWrapped.push({ u, a });
    }

    // (2) KHÔNG pepper: thử ĐÚNG mật khẩu nhưng bỏ secret → phải 0 khớp.
    let noPepperHits = 0;
    const noPepperN = Math.min(NO_PEPPER_SAMPLE, dictWrapped.length);
    for (let i = 0; i < noPepperN; i++) {
      if (await verify(dictWrapped[i]!.u.password_hash!, md5(dictWrapped[i]!.a.password))) noPepperHits++;
    }

    // (3) CÓ pepper, bẻ THẬT vài tài khoản mật khẩu phổ biến (vị trí nhỏ) trong ngân sách verify, để đối chứng.
    const byPos = dictWrapped
      .map((x) => ({ phc: x.u.password_hash!, pos: dictIndex.get(x.a.password) ?? Infinity }))
      .filter((x) => Number.isFinite(x.pos))
      .sort((a, b) => a.pos - b.pos);
    const realCracks: { pos: number; found: boolean }[] = [];
    let budget = REAL_CRACK_BUDGET;
    for (const { phc, pos } of byPos) {
      if (budget <= 0) break;
      let found = false;
      for (let i = 0; i <= pos && budget > 0; i++) {
        budget--;
        if (await verify(phc, md5(dict[i]!), PEPPER ? { secret: PEPPER } : {})) {
          found = true;
          break;
        }
      }
      realCracks.push({ pos, found });
    }

    const positions = byPos.map((x) => x.pos);
    const posP50 = median(positions);
    const posP90 = percentile(positions, 90);
    const fmt = (sec: number) =>
      sec < 90 ? `${sec.toFixed(1)} s` : sec < 5400 ? `${(sec / 60).toFixed(1)} phút` : sec < 129600 ? `${(sec / 3600).toFixed(1)} giờ` : `${(sec / 86400).toFixed(1)} ngày`;
    argon2 = {
      wrappedCount: wrapped.length,
      verifyMs: Number(verifyMs.toFixed(2)),
      verifyPerSec: Number(verifyPerSec.toFixed(1)),
      noPepper: { tried: noPepperN, cracked: noPepperHits },
      realCracked: realCracks.filter((r) => r.found).length,
      realTried: realCracks.length,
      extrapolation: {
        dictUsers: positions.length,
        dictPosP50: Math.round(posP50),
        dictPosP90: Math.round(posP90),
        perAccountSecP50: Number(((posP50 * verifyMs) / 1000).toFixed(1)),
        perAccountSecP90: Number(((posP90 * verifyMs) / 1000).toFixed(1)),
        perAccountP50Human: fmt((posP50 * verifyMs) / 1000),
        perAccountP90Human: fmt((posP90 * verifyMs) / 1000),
      },
    };
    console.log(`Argon2id trong dump: ${wrapped.length} dòng. Tốc độ ${verifyPerSec.toFixed(1)} verify/giây (đã đo, ${verifyMs.toFixed(1)} ms).`);
    console.log(`   KHÔNG pepper: thử đúng mật khẩu ${noPepperN} TK → bẻ ${noPepperHits} (pepper giữ bí mật = hash vô dụng).`);
    console.log(`   CÓ pepper: bẻ thật ${realCracks.filter((r) => r.found).length}/${realCracks.length} TK mật khẩu top trong ngân sách ${REAL_CRACK_BUDGET} verify; ngoại suy p50 ${fmt((posP50 * verifyMs) / 1000)}, p90 ${fmt((posP90 * verifyMs) / 1000)}/TK.`);
  }

  const gaps = sleep.stop();
  console.log(`\nTóm tắt dump: ${md5Result.crackedPctOfDump}% bẻ được tức thì qua MD5; cột Argon2id ${wrapped.length ? 'cần slow-hash (0% nếu giữ pepper)' : 'chưa có'}.`);
  if (gaps.length) console.log(`!! ${gaps.length} khoảng máy ngủ — chạy lại.`);
  console.log(`→ ${writeResult(OUT_NAME, { before, after: machineState(), dump, md5: md5Result, argon2, sleepGaps: gaps })}`);
} finally {
  await db.destroy();
}
