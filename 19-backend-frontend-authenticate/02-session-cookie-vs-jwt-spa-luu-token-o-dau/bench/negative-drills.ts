// Phép thử âm: gỡ từng điểm then chốt ĐỎ trong mã nguồn, chạy lại đúng file test tương ứng và xác nhận nó CHUYỂN
// ĐỎ. Mỗi chuỗi `find` phải xuất hiện ĐÚNG MỘT LẦN (nhật ký 08/01 điểm 4). Khôi phục file sau mỗi drill.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAB_DIR, writeResult } from './lib/lab';

interface Drill {
  name: string;
  file: string; // tương đối LAB_DIR
  find: string;
  replace: string;
  testFile: string;
}

const drills: Drill[] = [
  {
    name: 'bỏ HttpOnly khỏi cookie phiên → XSS đọc được phiên (cookie-flags đỏ)',
    file: 'src/sau/session.config.ts',
    find: 'httpOnly: true,',
    replace: 'httpOnly: false,',
    testFile: 'test/cookie-flags.test.ts',
  },
  {
    name: 'bỏ regenerate khi đăng nhập → session fixation (fixation đỏ)',
    file: 'src/sau/sau.controller.ts',
    find: 'await regenerate(req);',
    replace: '/* drill: bỏ regenerate */ await Promise.resolve();',
    testFile: 'test/session-fixation.test.ts',
  },
  {
    name: 'bỏ kiểm Origin trong CSRF guard → request origin lạ lọt (csrf đỏ)',
    file: 'src/sau/csrf.guard.ts',
    find: "throw new ForbiddenException({ error: 'bad_origin' });",
    replace: '/* drill: bỏ kiểm Origin */ void 0;',
    testFile: 'test/csrf-guard.test.ts',
  },
  {
    name: 'bỏ kiểm token CSRF → request thiếu/sai token lọt (csrf đỏ)',
    file: 'src/sau/csrf.guard.ts',
    find: "throw new ForbiddenException({ error: 'bad_csrf_token' });",
    replace: '/* drill: bỏ kiểm token */ void 0;',
    testFile: 'test/csrf-guard.test.ts',
  },
  {
    name: 'revoker không đọc tập phiên theo user → khóa user không xóa phiên (revoke đỏ)',
    file: 'src/sau/session-revoker.ts',
    find: 'const ids = await this.redis.smembers(key);',
    replace: 'const ids: string[] = []; /* drill: không đọc tập phiên */',
    testFile: 'test/session-revoke.test.ts',
  },
];

function runVitest(testFile: string): { failed: boolean; ranTests: boolean; tail: string } {
  const res = spawnSync(resolve(LAB_DIR, 'node_modules/.bin/vitest'), ['run', testFile], {
    cwd: LAB_DIR,
    encoding: 'utf8',
    env: { ...process.env },
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  // Dòng tổng kết "Tests  N failed | M passed (K)" — có thể chỉ có "failed" khi mọi test trong file đỏ.
  const line = (out.match(/\n\s*Tests\s+[^\n]*/) ?? [''])[0];
  const failedCount = Number((line.match(/(\d+) failed/) ?? [])[1] ?? 0);
  const passedCount = Number((line.match(/(\d+) passed/) ?? [])[1] ?? 0);
  return {
    failed: res.status !== 0,
    ranTests: failedCount + passedCount > 0, // nhật ký 03/01 điểm 5: đảm bảo có test chạy
    tail: out.trim().split('\n').slice(-4).join('\n'),
  };
}

async function main() {
  // Sanity: trạng thái gốc phải XANH cho mọi test.
  const base = runVitest('');
  if (base.failed) {
    console.error('Trạng thái gốc KHÔNG xanh — dừng.\n' + base.tail);
    process.exit(1);
  }
  console.log('Baseline: toàn bộ test XANH.\n');

  const results: { name: string; wentRed: boolean; ranTests: boolean; restored: boolean }[] = [];
  for (const d of drills) {
    const path = resolve(LAB_DIR, d.file);
    const original = readFileSync(path, 'utf8');
    const occurrences = original.split(d.find).length - 1;
    if (occurrences !== 1) {
      console.error(`✖ ${d.name}: chuỗi find xuất hiện ${occurrences} lần (cần 1) trong ${d.file}`);
      results.push({ name: d.name, wentRed: false, ranTests: false, restored: true });
      continue;
    }
    let restored = false;
    try {
      writeFileSync(path, original.replace(d.find, d.replace));
      const r = runVitest(d.testFile);
      results.push({ name: d.name, wentRed: r.failed, ranTests: r.ranTests, restored: false });
      console.log(`${r.failed && r.ranTests ? '✔' : '✖'} ${d.name} → ${r.failed ? 'ĐỎ' : 'vẫn XANH (sai!)'}${r.ranTests ? '' : ' (KHÔNG có test chạy!)'}`);
    } finally {
      writeFileSync(path, original);
      restored = readFileSync(path, 'utf8') === original;
      results[results.length - 1]!.restored = restored;
      if (!restored) console.error(`✖ KHÔNG khôi phục được ${d.file}!`);
    }
  }

  const ok = results.every((r) => r.wentRed && r.ranTests && r.restored);
  const file = writeResult('negative-drills.json', { at: new Date().toISOString(), results });
  console.log(`\n${results.filter((r) => r.wentRed && r.ranTests).length}/${results.length} drill đúng kỳ vọng (đỏ, có test chạy). Đã ghi ${file}`);
  process.exit(ok ? 0 : 1);
}

await main();
