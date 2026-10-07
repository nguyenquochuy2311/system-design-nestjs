import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

// Chuẩn bị một lần cho cả lượt test: ảnh của media-service và bản build production của Next (custom server cần .next).
export default function setup(): void {
  const media = process.env.MEDIA_DIR ?? '.data/media';
  if (!existsSync(media) || readdirSync(media).length === 0) run('pnpm', ['media:seed']);
  if (!existsSync('web/.next/BUILD_ID') || process.env.REBUILD_WEB === '1') run('pnpm', ['web:build']);
}

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} thất bại (mã ${res.status})`);
}
