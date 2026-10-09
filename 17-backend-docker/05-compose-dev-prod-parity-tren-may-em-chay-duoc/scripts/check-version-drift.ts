import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { checkDrift, type Finding, type ProductionVersions } from './lib/version-drift';

// `pnpm check:versions` — chạy trong CI (mỗi PR và định kỳ) để Compose không đứng yên khi production nâng cấp.
// Thoát 0 khi khớp, 1 khi có lệch (in rõ dịch vụ và tag), 2 khi tham số/file sai.
//   --db <dịch vụ>=<url>   (tùy chọn) hỏi `SHOW server_version` của DB đang chạy: bắt trường hợp tag ghi một đằng,
//                          image/DB thật một nẻo, hoặc ứng dụng nối nhầm PostgreSQL cài sẵn trên máy.
const { values } = parseArgs({
  options: {
    compose: { type: 'string', default: 'compose.yaml' },
    override: { type: 'string', default: 'compose.override.yaml' },
    production: { type: 'string', default: 'infra/production-versions.json' },
    nvmrc: { type: 'string', default: '.nvmrc' },
    package: { type: 'string', default: 'package.json' },
    'node-version': { type: 'string', default: process.version },
    db: { type: 'string', multiple: true, default: [] },
  },
});

for (const f of [values.compose, values.production]) {
  if (!existsSync(f)) {
    console.error(`Không thấy file ${f}`);
    process.exit(2);
  }
}

const findings: Finding[] = checkDrift({
  composeFile: values.compose,
  overrideFile: values.override,
  productionFile: values.production,
  nvmrcFile: values.nvmrc,
  packageFile: values.package,
  runningNode: values['node-version'],
});

const production = JSON.parse(readFileSync(values.production, 'utf8')) as ProductionVersions;
for (const spec of values.db) {
  const [service, url] = [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)];
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const v = (await client.query<{ server_version: string }>('SHOW server_version')).rows[0]?.server_version ?? '?';
    const running = /^\d+(?:\.\d+)*/.exec(v)?.[0];
    const want = production.services[service];
    if (running !== want) findings.push({ level: 'error', target: service, message: `DB đang chạy ${v}, production ${want ?? '(không khai báo)'}` });
    else console.log(`✔ [${service}] DB đang chạy ${v}`);
  } catch (e) {
    findings.push({ level: 'error', target: service, message: `không hỏi được phiên bản DB: ${(e as Error).message}` });
  } finally {
    await client.end().catch(() => undefined);
  }
}

for (const f of findings) console.log(`${f.level === 'error' ? '✖' : '•'} [${f.target}] ${f.message}`);
const errors = findings.filter((f) => f.level === 'error').length;
console.log(errors ? `Lệch phiên bản: ${errors} lỗi` : `✔ Khớp production (${Object.entries(production.services).map(([k, v]) => `${k} ${v}`).join(', ')}${production.node ? `, node ${production.node}` : ''})`);
process.exit(errors ? 1 : 0);
