/**
 * Phép thử âm: gỡ từng điểm then chốt của Dockerfile nhiều stage trong build context, build lại, chạy bộ kiểm
 * nội dung image (test (a)), kiểm uid và smoke test, rồi khôi phục context khớp byte (so với commit "ci checkout").
 *   RUN=main pnpm bench:negative     → bench/results/<RUN>/negative.json
 * Kỳ vọng ghi trong từng phép thử; "đỏ đúng chỗ" = bộ kiểm báo đúng loại vi phạm mong đợi.
 */
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyEdits, buildImage, checkRuntimeContents, CONTEXT_DIR, contextDirty, devDependencyNames, DOCKERFILES, imageInfo,
  listImageFiles, prepareContext, processUid, smokeTest, type Edit,
} from '../scripts/lib/docker.js';
import { contextBytes, machine, startSleepDetector, writeJson } from './lib.js';

const DF = DOCKERFILES.multi;
const RUNTIME_COPIES = 'COPY --from=prod-deps /out/package.json ./package.json\nCOPY --from=prod-deps /out/node_modules ./node_modules\nCOPY --from=prod-deps /out/dist ./dist\n';
const NAIVE_COPY = 'COPY --from=build /app ./\n';
const NAIVE_CMD: Edit = { file: DF, from: 'CMD ["node", "dist/main.js"]', to: 'CMD ["node", "apps/api/dist/main.js"]' };

interface Drill {
  id: string;
  what: string;
  edits: Edit[];
  removeDockerignore?: boolean;
  expectKinds: string[]; // loại vi phạm mong đợi; [] = mong đợi KHÔNG đỏ ở bộ kiểm nội dung
  expectRoot?: boolean;
}

const DRILLS: Drill[] = [
  { id: 'baseline', what: 'Dockerfile nhiều stage nguyên bản (đối chứng)', edits: [], expectKinds: [] },
  {
    id: 'copy-whole-build-stage', what: 'runtime chép cả stage build: COPY --from=build /app ./ (sai lầm 3.4)',
    edits: [{ file: DF, from: RUNTIME_COPIES, to: NAIVE_COPY }, NAIVE_CMD],
    expectKinds: ['devDependency', 'source', 'typescript', 'unexpected-app-entry'],
  },
  {
    id: 'deploy-without-prod', what: 'pnpm deploy thiếu --prod: node_modules runtime có cả devDependencies',
    edits: [{ file: DF, from: 'deploy --prod /out', to: 'deploy /out' }],
    expectKinds: ['devDependency', 'typescript'],
  },
  {
    id: 'shared-without-files', what: 'packages/shared/package.json bỏ trường "files": bản inject của @lab/shared mang cả src/',
    edits: [{ file: 'packages/shared/package.json', from: '  "files": [\n    "dist"\n  ],\n', to: '' }],
    expectKinds: ['source'],
  },
  {
    id: 'no-user', what: 'bỏ USER node: container chạy root',
    edits: [{ file: DF, from: 'USER node\n', to: '' }],
    expectKinds: [], expectRoot: true,
  },
  {
    id: 'no-dockerignore', what: 'xóa .dockerignore (Dockerfile nhiều stage giữ COPY chọn lọc)',
    edits: [], removeDockerignore: true, expectKinds: [],
  },
  {
    id: 'no-dockerignore-copy-all', what: 'xóa .dockerignore + stage build COPY . . + runtime chép cả stage build',
    edits: [
      { file: DF, from: 'COPY tsconfig.base.json ./\nCOPY packages/shared packages/shared\nCOPY apps/api apps/api\n', to: 'COPY . .\n' },
      { file: DF, from: RUNTIME_COPIES, to: NAIVE_COPY }, NAIVE_CMD,
    ],
    removeDockerignore: true, expectKinds: ['devDependency', 'git', 'source', 'typescript', 'unexpected-app-entry'],
  },
];

const sleep = startSleepDetector();
await prepareContext();
const devDeps = devDependencyNames();
const rows: Record<string, unknown>[] = [];
for (const d of DRILLS) {
  const restore = applyEdits(d.edits);
  const ignore = join(CONTEXT_DIR, '.dockerignore');
  if (d.removeDockerignore) renameSync(ignore, `${ignore}.off`);
  let row: Record<string, unknown> = {};
  try {
    const tag = `lab-17-01/neg-${d.id}:latest`;
    const b = await buildImage({ dockerfile: DF, tag, target: 'runtime' });
    if (!b.ok) throw new Error(`${d.id}: build lỗi\n${b.out.slice(-2000)}`);
    const files = await listImageFiles(tag);
    const kinds = [...new Set(checkRuntimeContents(files, devDeps).map((x) => x.kind))].sort();
    const uid = await processUid(tag);
    const smoke = await smokeTest(tag);
    const info = await imageInfo(tag);
    const contentRed = kinds.length > 0;
    const asExpected = JSON.stringify(kinds) === JSON.stringify([...d.expectKinds].sort()) && (uid === '0') === Boolean(d.expectRoot);
    row = {
      id: d.id, what: d.what, kinds, uid, contentRed, rootRed: uid === '0', smokeOk: smoke.ok, smokeReason: smoke.reason,
      contentBytes: info.size, files: files.length, contextBytes: contextBytes(b.out), expectKinds: d.expectKinds, expectRoot: Boolean(d.expectRoot), asExpected,
    };
  } finally {
    if (d.removeDockerignore) renameSync(`${ignore}.off`, ignore);
    restore();
  }
  const dirty = await contextDirty();
  if (dirty) throw new Error(`context chưa khôi phục sau ${d.id}:\n${dirty}`);
  rows.push({ ...row, restored: true });
  console.log(`${row.asExpected ? '✔' : '✖'} ${d.id}: vi phạm [${(row.kinds as string[]).join(', ')}] uid ${row.uid} smoke ${row.smokeOk ? 'xanh' : 'đỏ'} · ${(Number(row.contentBytes) / 1e6).toFixed(1)} MB · context ${row.contextBytes} B`);
}
sleep.stop();
writeJson('negative.json', { env: await machine(), rows, sleepGaps: sleep.gaps });
if (rows.some((r) => !r.asExpected)) process.exitCode = 1;
