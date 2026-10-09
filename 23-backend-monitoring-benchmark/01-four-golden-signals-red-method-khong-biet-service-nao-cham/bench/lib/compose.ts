// Gọi docker compose của lab (project `lab-23-01`, xem compose.yaml).
import { mustRun, run, type RunResult } from './proc.js';

export function compose(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return mustRun('docker', ['compose', ...args], { env });
}

/** Dựng lại 3 service với instrumentation bật/tắt (OTEL_SDK_DISABLED); Compose tự tạo lại container khi env đổi. */
export async function servicesWithTelemetry(enabled: boolean, opts: { noDeps?: boolean } = {}) {
  await compose(
    ['up', '-d', '--wait', ...(opts.noDeps ? ['--no-deps'] : []), 'promotion', 'checkout', 'gateway'],
    { OTEL_SDK_DISABLED: enabled ? 'false' : 'true' },
  );
}

/** Chạy k6 trong container cùng mạng Compose (profile bench). Không chặn event loop. */
export function k6(script: string, env: Record<string, string>, summaryFile: string): Promise<RunResult> {
  const e = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return run('docker', [
    'compose', '--profile', 'bench', 'run', '--rm', '-T', 'k6',
    'run', '--quiet', '--no-color', ...e, '--summary-export', `/results/${summaryFile}`, `/bench/${script}`,
  ]);
}
