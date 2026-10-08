/**
 * Dọn ĐÚNG đồ của lab 17/02: builder `lab-17-02-*` (`docker buildx rm`: container BuildKit + volume trạng thái gồm layer
 * cache và cache mount), container nhãn lab.id=17-02 ngoài compose, image tag `lab-17-02/*`, image nhãn lab.id=17-02.
 * Không prune toàn cục, không đụng builder/cache/image của dự án khác. Registry (và cache registry trong volume của nó)
 * dọn bằng `docker compose down -v`. Image công cụ (moby/buildkit, registry, node) giữ lại; xóa tay nếu muốn (README mục 8).
 */
import { labBuilders, removeBuilder, run } from './lib/docker.js';

const builders = await labBuilders();
for (const b of builders) await removeBuilder(b);

const containers = (await run('docker', ['ps', '-aq', '--filter', 'label=lab.id=17-02'])).out.split('\n').filter(Boolean);
const compose = (await run('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=lab-17-02'])).out.split('\n').filter(Boolean);
const toRemove = containers.filter((c) => !compose.includes(c));
if (toRemove.length) await run('docker', ['rm', '-f', ...toRemove]);

const refs = (await run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])).out.split('\n').filter((r) => r.startsWith('lab-17-02/'));
if (refs.length) await run('docker', ['rmi', '-f', ...refs]);
const labelled = [...new Set((await run('docker', ['image', 'ls', '-q', '--filter', 'label=lab.id=17-02'])).out.split('\n').filter(Boolean))];
if (labelled.length) await run('docker', ['rmi', '-f', ...labelled]);
console.log(`Đã xóa ${builders.length} builder (${builders.join(', ') || '—'}), ${toRemove.length} container, ${refs.length} tag, ${labelled.length} image theo nhãn.`);
