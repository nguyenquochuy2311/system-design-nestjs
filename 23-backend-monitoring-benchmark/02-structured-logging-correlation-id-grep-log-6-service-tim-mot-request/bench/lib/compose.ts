// Gọi docker compose của lab (project `lab-23-02`, xem compose.yaml).
import { mustRun, run, sleep, type RunResult } from './proc.js';

export const APP_SERVICES = ['ledger', 'bank-adapter', 'topup', 'gateway'] as const;

export function compose(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return mustRun('docker', ['compose', ...args], { env });
}

/**
 * Dựng lại 4 service với LOG_MODE (truoc/sau/off) và LAB_DRILL (phép thử âm). Compose tạo lại container khi env đổi;
 * `--force-recreate` để mỗi lượt bắt đầu với file log container mới (Collector đọc file mới từ đầu) và process mới.
 */
export async function appMode(mode: 'truoc' | 'sau' | 'off', drill = '', logSync = true) {
  await compose(['up', '-d', '--wait', '--no-deps', '--force-recreate', ...APP_SERVICES], { LOG_MODE: mode, LAB_DRILL: drill, LOG_SYNC: String(logSync) });
  await sleep(1500);
}

/** Chạy k6 trong container cùng mạng Compose (profile bench). Không chặn event loop. */
export function k6(script: string, env: Record<string, string>, summaryFile: string): Promise<RunResult> {
  const e = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return run('docker', [
    'compose', '--profile', 'bench', 'run', '--rm', '-T', 'k6',
    'run', '--quiet', '--no-color', ...e, '--summary-export', `/results/${summaryFile}`, `/bench/${script}`,
  ]);
}
