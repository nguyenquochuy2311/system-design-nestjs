// OWASP ZAP passive baseline scan (KHÔNG active scan) quét URL localhost của lab qua host.docker.internal.
// Image chính thức, ghim tag + ghi lại digest. Báo cáo thô để trong zap/ (gitignore); ở đây ghi tóm tắt cảnh báo.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureWebBuild, LAB_DIR, startApi, startWeb, benchSecrets, writeResult } from './lib/lab';

const ZAP_IMAGE = process.env.ZAP_IMAGE ?? 'ghcr.io/zaproxy/zaproxy:stable';
const ZAP_DIR = resolve(LAB_DIR, 'zap');
const RISK = ['Informational', 'Low', 'Medium', 'High'];

function sh(cmd: string): { ok: boolean; out: string } {
  const r = spawnSync('/bin/zsh', ['-c', cmd], { cwd: LAB_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function parseReport(name: string): { risk: string; name: string; count: number }[] {
  const path = resolve(ZAP_DIR, name);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const alerts: { risk: string; name: string; count: number }[] = [];
  for (const site of data.site ?? [])
    for (const a of site.alerts ?? []) alerts.push({ risk: RISK[Number(a.riskcode)] ?? a.riskcode, name: a.name, count: Number(a.count ?? a.instances?.length ?? 0) });
  return alerts.sort((x, y) => Number(y.risk > x.risk) - Number(x.risk > y.risk));
}

async function scan(targetPath: string, out: string): Promise<{ exit: number }> {
  // -I: không trả mã lỗi vì cảnh báo; -j: AJAX spider cho SPA; -m 1: spider tối đa 1 phút; chỉ passive.
  const cmd = [
    'docker run --rm',
    `-v ${ZAP_DIR}:/zap/wrk/:rw`,
    ZAP_IMAGE,
    'zap-baseline.py',
    `-t http://host.docker.internal:3200${targetPath}`,
    `-J ${out}`,
    '-I -j -m 1',
  ].join(' ');
  console.log(`$ ${cmd}`);
  const r = sh(cmd);
  console.log(r.out.trim().split('\n').slice(-12).join('\n'));
  return { exit: r.ok ? 0 : 1 };
}

async function main() {
  mkdirSync(ZAP_DIR, { recursive: true });

  const df = sh('df -h / | tail -1').out.trim();
  const dockerDf = sh('docker system df').out;
  console.log(`Đĩa host: ${df}`);

  // Kéo image (ghi digest). Image ~1.3 GB.
  console.log(`Kéo ${ZAP_IMAGE}…`);
  const pull = sh(`docker pull ${ZAP_IMAGE}`);
  if (!pull.ok) {
    writeResult('zap.json', { at: new Date().toISOString(), status: 'chưa làm', reason: `docker pull thất bại: ${pull.out.slice(-300)}`, df });
    console.error('Không kéo được image ZAP — ghi "chưa làm".');
    return;
  }
  const digest = sh(`docker inspect --format '{{index .RepoDigests 0}}' ${ZAP_IMAGE}`).out.trim();
  const version = sh(`docker run --rm ${ZAP_IMAGE} zap-baseline.py -h >/dev/null 2>&1; docker run --rm --entrypoint zap.sh ${ZAP_IMAGE} -version 2>/dev/null | head -1`).out.trim();

  const build = ensureWebBuild();
  if (build.built) console.log(`next build web: ${build.seconds}s`);
  const api = await startApi(benchSecrets());
  const web = await startWeb();
  try {
    await scan('/truoc', 'truoc.json');
    await scan('/sau', 'sau.json');
  } finally {
    await web.stop();
    await api.stop();
  }

  const truoc = parseReport('truoc.json');
  const sau = parseReport('sau.json');
  const summarize = (alerts: { risk: string; name: string }[]) => {
    const byRisk: Record<string, number> = {};
    for (const a of alerts) byRisk[a.risk] = (byRisk[a.risk] ?? 0) + 1;
    return byRisk;
  };
  const result = {
    at: new Date().toISOString(),
    image: ZAP_IMAGE,
    digest,
    version,
    df,
    dockerDfTail: dockerDf.trim().split('\n').slice(0, 2),
    truoc: { byRisk: summarize(truoc), alerts: truoc },
    sau: { byRisk: summarize(sau), alerts: sau },
  };
  const file = writeResult('zap.json', result);
  console.log('\n=== Tóm tắt ZAP ===');
  console.log('truoc:', JSON.stringify(result.truoc.byRisk), truoc.map((a) => `${a.risk}:${a.name}`));
  console.log('sau:  ', JSON.stringify(result.sau.byRisk), sau.map((a) => `${a.risk}:${a.name}`));
  console.log(`Đã ghi ${file}; báo cáo thô: zap/truoc.json, zap/sau.json (gitignore)`);
}

void execSync;
await main();
