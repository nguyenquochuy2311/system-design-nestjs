import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRelease, listFiles } from '../scripts/build-release';

const sha = (dir: string, f: string) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
const filesOf = (dir: string) => listFiles(dir).filter((f) => !f.startsWith('.vite/'));
const tmp = mkdtempSync(join(tmpdir(), 'lab-04-02-build-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('tên file theo hash nội dung', () => {
  it('hai lần build cùng mã nguồn cho cùng tên file và cùng nội dung', async () => {
    const a = await buildRelease('sau', '42', { outDir: join(tmp, 'a') });
    const b = await buildRelease('sau', '42', { outDir: join(tmp, 'b') });
    expect(filesOf(b)).toEqual(filesOf(a));
    for (const f of filesOf(a)) expect(sha(b, f), f).toBe(sha(a, f));
  });

  it('bản 43 chỉ sửa màn Báo cáo: vendor và CSS giữ nguyên tên; chunk báo cáo, entry và index.html đổi', async () => {
    const r42 = await buildRelease('sau', '42');
    const r43 = await buildRelease('sau', '43');
    const pick = (dir: string, prefix: string) => filesOf(dir).filter((f) => f.startsWith(`assets/${prefix}-`));
    expect(pick(r43, 'vendor')).toEqual(pick(r42, 'vendor'));
    expect(pick(r43, 'index').filter((f) => f.endsWith('.css'))).toEqual(pick(r42, 'index').filter((f) => f.endsWith('.css')));
    expect(pick(r43, 'reports')).not.toEqual(pick(r42, 'reports'));
    expect(pick(r43, 'index').filter((f) => f.endsWith('.js'))).not.toEqual(pick(r42, 'index').filter((f) => f.endsWith('.js')));
    expect(sha(r43, 'index.html')).not.toBe(sha(r42, 'index.html'));
  });

  it('bản trước (tái hiện): mọi bản dùng cùng tên file, nên cùng một URL mang nội dung khác nhau', async () => {
    const r41 = await buildRelease('truoc', '41');
    const r42 = await buildRelease('truoc', '42');
    expect(filesOf(r41)).toEqual(['app.css', 'app.js', 'index.html', 'reports.js', 'vendor.js', 'widget.js']);
    expect(filesOf(r42)).toEqual(filesOf(r41));
    expect(sha(r42, 'app.js')).not.toBe(sha(r41, 'app.js'));
  });
});
