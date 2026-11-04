import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dockerBin = `${process.env.HOME}/.docker/bin`;
const env = { ...process.env, PATH: `${dockerBin}:${process.env.PATH}` };

export const ORDER_URL = 'http://127.0.0.1:3100';

export async function kubectl(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', ['compose', 'exec', '-T', 'k3s', 'kubectl', ...args], {
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

const k = (...args: string[]) => kubectl('-n', 'logistics', ...args);

/** Apply manifest và chờ cả hai Deployment sẵn sàng. */
export async function deploy(replicas = 2): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const nodes = await kubectl('get', 'nodes', '--no-headers').catch(() => '');
    if (/\bReady\b/.test(nodes)) {
      break;
    }
    await sleep(2_000);
  }
  // Xóa trước để pod mới đọc lại dist/ và Service nhận đúng manifest: clusterIP không sửa được bằng apply.
  await kubectl('delete', 'namespace', 'logistics', '--ignore-not-found', '--wait=true');
  await kubectl('apply', '-f', '/lab/k8s/');
  await k('scale', 'deployment/pricing', `--replicas=${replicas}`);
  await k('rollout', 'status', 'deployment/pricing', '--timeout=200s');
  await k('rollout', 'status', 'deployment/order', '--timeout=200s');
  await waitForOrder();
}

async function waitForOrder(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const reply = await fetch(`${ORDER_URL}/quote?km=1`).catch(() => undefined);
    if (reply?.status === 200) {
      return;
    }
    await sleep(500);
  }
  throw new Error('order chưa trả lời');
}

export interface Pod {
  name: string;
  ip: string;
  ready: boolean;
  /** Thời điểm chuyển sang Ready, độ phân giải một giây. */
  readyAt: number;
  restarts: number;
}

export async function pricingPods(): Promise<Pod[]> {
  const raw = await k('get', 'pods', '-l', 'app=pricing', '-o', 'json');
  const { items } = JSON.parse(raw) as {
    items: {
      metadata: { name: string; deletionTimestamp?: string };
      status: {
        podIP?: string;
        conditions?: { type: string; status: string; lastTransitionTime: string }[];
        containerStatuses?: { restartCount: number }[];
      };
    }[];
  };
  return items
    .filter((item) => !item.metadata.deletionTimestamp)
    .map((item) => {
      const ready = item.status.conditions?.find((condition) => condition.type === 'Ready');
      return {
        name: item.metadata.name,
        ip: item.status.podIP ?? '',
        ready: ready?.status === 'True',
        readyAt: Date.parse(ready?.lastTransitionTime ?? ''),
        restarts: item.status.containerStatuses?.[0]?.restartCount ?? 0,
      };
    });
}

/** Bật tắt cờ trong pod; trả thời điểm cờ đổi theo đồng hồ của pod, cùng đồng hồ với thống kê của order. */
export async function setPodReady(pod: string, ok: boolean): Promise<number> {
  const script = `fetch('http://127.0.0.1:3000/admin/ready?ok=${String(ok)}',{method:'POST'}).then(r=>r.text()).then(console.log)`;
  return (JSON.parse(await k('exec', pod, '--', 'node', '-e', script)) as { at: number }).at;
}

/** Pod này còn được đánh dấu ready trong EndpointSlice của Service pricing không. */
export async function inEndpointSlice(ip: string): Promise<boolean> {
  const raw = await k('get', 'endpointslices', '-l', 'kubernetes.io/service-name=pricing', '-o', 'json');
  const { items } = JSON.parse(raw) as {
    items: { endpoints?: { addresses: string[]; conditions?: { ready?: boolean } }[] }[];
  };
  return items.some((slice) =>
    slice.endpoints?.some((endpoint) => endpoint.addresses.includes(ip) && endpoint.conditions?.ready === true),
  );
}

export const rolloutRestart = async () => {
  await k('rollout', 'restart', 'deployment/pricing');
  await k('rollout', 'status', 'deployment/pricing', '--timeout=200s');
};

export const scalePricing = async (replicas: number) => {
  await k('scale', 'deployment/pricing', `--replicas=${replicas}`);
  await k('rollout', 'status', 'deployment/pricing', '--timeout=200s');
};

export const setConnectionAge = async (ageMs: number) => {
  await k('set', 'env', 'deployment/order', `CONNECTION_MAX_AGE_MS=${ageMs}`);
  await k('rollout', 'status', 'deployment/order', '--timeout=200s');
  await waitForOrder();
};

export interface OrderStats {
  byPod: Record<string, { count: number; firstAt: number; lastAt: number }>;
  perSecond: Record<string, { ok: number; failed: number }>;
}

/** Pod order vừa được thay thì kết nối keep-alive của phía đo đã chết: gọi lại một lần. */
const callOrder = (url: string, init?: RequestInit) => fetch(url, init).catch(() => fetch(url, init));

export const orderStats = async (url = ORDER_URL) => (await (await callOrder(`${url}/stats`)).json()) as OrderStats;
export const resetStats = () => callOrder(`${ORDER_URL}/stats/reset`, { method: 'POST' });

/** Gọi đều đặn ở tốc độ cố định cho tới khi dừng; trả mã trạng thái của mọi lời gọi. */
export function startTraffic(ratePerSecond: number) {
  const statuses: number[] = [];
  const pending: Promise<void>[] = [];
  const timer = setInterval(() => {
    pending.push(
      fetch(`${ORDER_URL}/quote?km=1`)
        .then((reply) => {
          statuses.push(reply.status);
        })
        .catch(() => {
          statuses.push(0);
        }),
    );
  }, 1_000 / ratePerSecond);
  return {
    stop: async () => {
      clearInterval(timer);
      await Promise.all(pending);
      return statuses;
    },
  };
}
