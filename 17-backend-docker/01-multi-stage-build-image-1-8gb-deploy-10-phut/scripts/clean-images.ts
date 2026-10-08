/**
 * Dọn ĐÚNG đồ của lab: container nhãn lab.id=17-01, image tag `lab-17-01/*` và `<registry>/lab-17-01/*`,
 * image nhãn lab.id=17-01 (kể cả dangling). Không prune toàn cục, không đụng image/cache của dự án khác.
 * Base image (node, registry, trivy, docker:dind) và volume cache Trivy giữ lại; xóa tay nếu muốn (README mục 8).
 */
import { REGISTRY_HOST, run } from './lib/docker.js';

const containers = (await run('docker', ['ps', '-aq', '--filter', 'label=lab.id=17-01'])).out.split('\n').filter(Boolean);
// Container của compose (registry) cũng mang nhãn lab.id — chỉ xóa container không thuộc compose.
const compose = (await run('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=lab-17-01'])).out.split('\n').filter(Boolean);
const toRemove = containers.filter((c) => !compose.includes(c));
if (toRemove.length) await run('docker', ['rm', '-f', ...toRemove]);

const refs = (await run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])).out.split('\n')
  .filter((r) => r.startsWith('lab-17-01/') || r.startsWith(`${REGISTRY_HOST}/lab-17-01/`) || r.startsWith('registry:5000/lab-17-01/'));
if (refs.length) await run('docker', ['rmi', '-f', ...refs]);
const labelled = (await run('docker', ['image', 'ls', '-q', '--filter', 'label=lab.id=17-01'])).out.split('\n').filter(Boolean);
if (labelled.length) await run('docker', ['rmi', '-f', ...new Set(labelled)]);
console.log(`Đã xóa ${toRemove.length} container, ${refs.length} tag, ${new Set(labelled).size} image theo nhãn.`);
