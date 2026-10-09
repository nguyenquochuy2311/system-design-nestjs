import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testUrls } from './support/db';

// (c) scripts/check-version-drift.ts chạy như trong CI (tiến trình con, đọc mã thoát thật). Mỗi ca sai lệch là bản sao
// của file thật trong thư mục tạm, sửa đúng một chỗ; ca "khớp" chạy trên chính file của lab.
const LAB = resolve(import.meta.dirname, '..');
const TSX = join(LAB, 'node_modules/tsx/dist/cli.mjs');
const SCRIPT = join(LAB, 'scripts/check-version-drift.ts');
const FILES = ['compose.yaml', 'compose.override.yaml', '.nvmrc', 'package.json', 'infra/production-versions.json'];

function run(cwd: string, ...args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [TSX, SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Bản sao các file cần kiểm vào thư mục tạm, áp một thay đổi lên một file. */
function variant(file: string, edit: (s: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-17-05-drift-'));
  for (const f of FILES) cpSync(join(LAB, f), join(dir, f), { recursive: true });
  const before = readFileSync(join(dir, file), 'utf8');
  const after = edit(before);
  expect(after, `thay đổi phải có tác dụng lên ${file}`).not.toBe(before);
  writeFileSync(join(dir, file), after);
  return dir;
}
const setPostgresImage = (image: string) => (s: string) => s.replace(/image: postgres:\S+/, `image: ${image}`);

describe('(c) script kiểm lệch phiên bản Compose / Node so với production giả lập', () => {
  it('file thật của lab khớp production-versions.json → thoát 0', () => {
    const r = run(LAB);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Khớp production \(postgres 16\.15, node 20\.19\.6\)/);
  });

  it('tag postgres khác production (15.14) → thoát 1, chỉ rõ dịch vụ và tag', () => {
    const r = run(variant('compose.yaml', setPostgresImage('postgres:15.14')));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/\[postgres\] tag "15\.14" \(phiên bản 15\.14\) khác production 16\.15/);
  });

  it('tag trôi postgres:16 (không ghim bản vá) → thoát 1, nhắc ghim 16.15', () => {
    const r = run(variant('compose.yaml', setPostgresImage('postgres:16')));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/\[postgres\] tag "16" không ghim bản vá.*ghim "16\.15"/);
  });

  it('tag latest hoặc không có tag → thoát 1', () => {
    for (const image of ['postgres:latest', 'postgres']) {
      const r = run(variant('compose.yaml', setPostgresImage(image)));
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/\[postgres\] image "postgres(:latest)?" không ghim phiên bản/);
    }
  });

  it('khớp tag nhưng thiếu digest → chỉ cảnh báo, thoát 0', () => {
    const r = run(variant('compose.yaml', setPostgresImage('postgres:16.15')));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/• \[postgres\] image "postgres:16\.15" không ghim digest/);
  });

  it('compose.override.yaml (chỉ dev) đặt image → thoát 1 vì dev sẽ chạy khác CI', () => {
    const r = run(variant('compose.override.yaml', (s) => s.replace('  postgres:\n', '  postgres:\n    image: postgres:16.15\n')));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/\[postgres\] compose.override.yaml đặt image "postgres:16\.15"/);
  });

  it('dịch vụ có trong compose mà production không khai báo → thoát 1', () => {
    const r = run(variant('compose.yaml', (s) => s.replace('\nvolumes:', '  redis:\n    image: redis:7.4.6\n\nvolumes:')));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/\[redis\] dịch vụ "redis" \(redis:7\.4\.6\) có trong compose.yaml nhưng không có trong/);
  });

  it('.nvmrc khác production, .nvmrc không thỏa engines, Node đang chạy khác minor → thoát 1', () => {
    const nvmrc = run(variant('.nvmrc', () => '20.18.0\n'));
    expect(nvmrc.code, nvmrc.out).toBe(1);
    expect(nvmrc.out).toMatch(/\[node\] \.nvmrc ghi "20\.18\.0" khác production Node 20\.19\.6/);
    expect(nvmrc.out).toMatch(/\[node\] \.nvmrc "20\.18\.0" không thỏa engines\.node ">=20\.19\.6 <21"/);

    const running = run(LAB, '--node-version', 'v22.11.0');
    expect(running.code, running.out).toBe(1);
    expect(running.out).toMatch(/\[node\] Node đang chạy v22\.11\.0 khác production 20\.19\.6 ở mức minor/);
  });

  it('--db: PostgreSQL của compose đang chạy đúng phiên bản production → thoát 0', () => {
    const r = run(LAB, '--db', `postgres=${testUrls().app}`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/✔ \[postgres\] DB đang chạy 16\.15/);
  });
});
