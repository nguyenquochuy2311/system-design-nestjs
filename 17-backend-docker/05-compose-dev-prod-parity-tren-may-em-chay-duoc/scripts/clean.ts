import { spawnSync } from 'node:child_process';

// Dọn CHỈ đồ của lab 17/05: project compose lab-17-05, container/volume có nhãn lab.id=17-05 (container tạm của bench).
// `--pg14-image` xóa thêm image postgres:14.24 mà chỉ lab này kéo về. Không prune toàn cục, không đụng postgres:16*.
const sh = (cmd: string) => {
  const r = spawnSync('/bin/zsh', ['-c', cmd], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`.trim();
  console.log(`$ ${cmd}${out ? `\n${out}` : ''}`);
};
sh('docker compose -p lab-17-05 down -v --remove-orphans');
sh('ids=$(docker ps -aq --filter label=lab.id=17-05); [ -n "$ids" ] && docker rm -f -v $ids || true');
sh('ids=$(docker volume ls -q --filter label=lab.id=17-05); [ -n "$ids" ] && docker volume rm $ids || true');
if (process.argv.includes('--pg14-image')) {
  sh('docker image rm postgres@sha256:14bfab572eec6abf65892e1db7c3ba8d41b2a2855c1b143664907d6e146eb6e1 || true');
}
