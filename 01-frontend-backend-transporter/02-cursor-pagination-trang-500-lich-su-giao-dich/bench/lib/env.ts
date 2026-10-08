import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** Thư mục kết quả của lượt: bench/results/$RUN (mặc định "trial"). Lượt chính dùng RUN=main; chạy lại thì đổi tên. */
export const RUN = process.env.RUN ?? 'trial';
export const RESULTS_DIR = resolve(LAB_DIR, 'bench/results', RUN);

const sh = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** Điều kiện máy lúc đo: nguồn điện, nắp, load 1 phút của macOS (quy-trinh-lab mục 1 điểm 5, nhật ký 04/03 điểm 6). */
export function machineState() {
  const batt = sh('pmset -g batt');
  return {
    at: new Date().toISOString(),
    power: /AC Power/.test(batt) ? 'sạc' : /Battery Power/.test(batt) ? 'pin' : 'không rõ',
    battery: batt.match(/(\d+)%/)?.[1] ? Number(batt.match(/(\d+)%/)![1]) : null,
    lidClosed: /Yes/.test(sh('ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState')),
    load1: Number(sh('sysctl -n vm.loadavg').replace(/[{}]/g, '').trim().split(/\s+/)[0] ?? NaN),
  };
}

export function writeResult(name: string, data: unknown): string {
  const file = resolve(RESULTS_DIR, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Ghi khoảng máy ngủ (nhật ký 04/02 điểm 5): hai nhịp 1 giây cách nhau quá 2,5 giây.
 * Lượt có khoảng ngủ phải chạy lại dưới tên khác.
 */
export function startSleepDetector() {
  const gaps: { at: string; seconds: number }[] = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - last > 2500) gaps.push({ at: new Date(now).toISOString(), seconds: (now - last) / 1000 });
    last = now;
  }, 1000);
  timer.unref();
  return { stop: () => (clearInterval(timer), gaps) };
}
