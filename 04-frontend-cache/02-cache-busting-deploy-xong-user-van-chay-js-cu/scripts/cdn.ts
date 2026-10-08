/**
 * Điều khiển hai container Nginx của lab từ script và test.
 * - purgeCdn(): "xóa cache CDN" — đổi thế hệ khóa cache rồi nginx -s reload (êm, không cắt kết nối đang mở). Bản lưu
 *   cũ vẫn nằm trên tmpfs nhưng không khóa nào trỏ tới nữa. Cách này thay cho purge của CDN thật.
 * - reloadNginx(): nạp lại cấu hình (phép thử âm sửa nginx/*.conf).
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { LAB_DIR } from './build-release';

const execFileAsync = promisify(execFile);
export const CDN_PORT = 58088;

export async function compose(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', ['compose', ...args], { cwd: LAB_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function reloadNginx(service: 'cdn' | 'origin'): Promise<void> {
  await compose('exec', '-T', service, 'nginx', '-c', `/etc/nginx/lab/${service}.conf`, '-t', '-q');
  await compose('exec', '-T', service, 'nginx', '-c', `/etc/nginx/lab/${service}.conf`, '-s', 'reload');
  // Worker mới nhận request sau khi reload xong; chờ ngắn cho worker cũ thôi nhận.
  await sleep(300);
}

export async function purgeCdn(): Promise<string> {
  const gen = `g${Date.now().toString(36)}`;
  const dir = join(LAB_DIR, '.data/cdn-state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'generation.conf'), `set $cache_gen "${gen}";\n`);
  await reloadNginx('cdn');
  return gen;
}
