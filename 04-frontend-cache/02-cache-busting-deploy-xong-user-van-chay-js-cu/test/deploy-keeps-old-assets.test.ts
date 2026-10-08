import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRelease, listFiles } from '../scripts/build-release';
import { deploy, resetSite, wwwDirOf, type DeployStep } from '../scripts/deploy';
import { manifestOf, staticRefs } from './support/lab';

const www = wwwDirOf('sau');
const assetsOf = (dir: string) => listFiles(dir).filter((f) => f.startsWith('assets/'));

describe('script deploy', () => {
  it('bản sau chép assets trước, index.html sau cùng; lúc ghi index.html mọi file nó cần đã có', async () => {
    resetSite('sau');
    await deploy({ site: 'sau', release: '41', api: null });
    const build42 = await buildRelease('sau', '42');
    const needed = [
      ...staticRefs(readFileSync(join(build42, 'index.html'), 'utf8')).map((r) => r.slice(1)),
      ...Object.values(manifestOf(build42)).map((m) => m.file),
    ];
    const missingAtIndex: string[] = [];
    const steps: DeployStep[] = [];
    await deploy({
      site: 'sau',
      release: '42',
      api: null,
      onStep: (s) => {
        steps.push(s);
        if (s.action === 'copy' && s.file === 'index.html') missingAtIndex.push(...needed.filter((f) => !existsSync(join(www, f))));
      },
    });
    expect(missingAtIndex).toEqual([]);
    const writes = steps.filter((s) => s.action === 'copy' || s.action === 'skip');
    expect(writes.at(-1)?.file).toBe('index.html');
  });

  it('bản sau giữ assets của 3 bản gần nhất và dọn bản cũ hơn; chunk dùng chung (vendor) vẫn còn', async () => {
    resetSite('sau');
    const builds: Record<string, string[]> = {};
    for (const r of ['41', '42', '43', '44'] as const) {
      const res = await deploy({ site: 'sau', release: r, api: null });
      builds[r] = assetsOf(res.buildDir);
    }
    const live = new Set(assetsOf(www));
    for (const r of ['42', '43', '44']) for (const f of builds[r]!) expect(live.has(f), `${r}: ${f}`).toBe(true);
    const onlyIn41 = builds['41']!.filter((f) => !['42', '43', '44'].some((r) => builds[r]!.includes(f)));
    expect(onlyIn41.length).toBeGreaterThan(0);
    for (const f of onlyIn41) expect(live.has(f), f).toBe(false);
    expect(builds['41']!.find((f) => f.startsWith('assets/vendor-'))).toBe(builds['44']!.find((f) => f.startsWith('assets/vendor-')));
  });

  it('bản trước (tái hiện, như rsync --delete): cùng tên file nên bản mới ghi đè, nội dung bản 41 không còn ở máy gốc', async () => {
    resetSite('truoc');
    const r41 = (await deploy({ site: 'truoc', release: '41', api: null })).buildDir;
    const r42 = (await deploy({ site: 'truoc', release: '42', api: null })).buildDir;
    const live = wwwDirOf('truoc');
    expect(listFiles(live)).toEqual(listFiles(r42).filter((f) => !f.startsWith('.vite/')));
    expect(readFileSync(join(live, 'app.js'), 'utf8')).toBe(readFileSync(join(r42, 'app.js'), 'utf8'));
    expect(readFileSync(join(live, 'app.js'), 'utf8')).not.toBe(readFileSync(join(r41, 'app.js'), 'utf8'));
  });
});
