import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  deploy,
  ORDER_URL,
  orderStats,
  pricingPods,
  resetStats,
  rolloutRestart,
  scalePricing,
  setConnectionAge,
  setPodReady,
  startTraffic,
} from '../support/cluster';

const READINESS_LIMIT_MS = 2_000 * 2;
const CONNECTION_AGE_MS = 1_000;

describe('Kubernetes làm service registry', () => {
  beforeAll(() => deploy(2));

  it('headless Service trả đúng IP các pod Ready', async () => {
    const pods = await pricingPods();

    const reply = (await (await fetch(`${ORDER_URL}/discover`)).json()) as { addresses: string[] };

    expect(reply.addresses).toEqual(pods.filter((pod) => pod.ready).map((pod) => pod.ip).sort());
    expect(reply.addresses).toHaveLength(2);
  });

  it('phần còn ở máy ảo gọi được bằng tên DNS như mọi service khác', async () => {
    const reply = (await (await fetch(`${ORDER_URL}/legacy`)).json()) as { status: number };

    expect(reply.status).toBe(200);
  });

  it('rollout restart không sinh request lỗi nào', async () => {
    const traffic = startTraffic(20);

    // Ba lần: không có preStop thì lỗi xảy ra theo xác suất, một lần có thể lọt.
    for (let round = 0; round < 3; round += 1) {
      await rolloutRestart();
    }
    await sleep(2_000);

    const statuses = await traffic.stop();
    expect(statuses.length).toBeGreaterThan(100);
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
  });

  it('pod chưa Ready không nhận request, và không bị khởi động lại', async () => {
    await resetStats();
    const traffic = startTraffic(20);
    await sleep(5_000);
    const { byPod } = await orderStats();
    const name = Object.entries(byPod).sort(([, a], [, b]) => b.lastAt - a.lastAt)[0]?.[0] as string;
    const restarts = (await pricingPods()).find((pod) => pod.name === name)?.restarts;

    const flaggedAt = await setPodReady(name, false);
    // Lâu hơn ngưỡng liveness 5 × 3 giây: nếu liveness kiểm nhầm /ready thì pod bị khởi động lại trong khoảng này.
    await sleep(20_000);
    const statuses = await traffic.stop();

    const lastAt = (await orderStats()).byPod[name]?.lastAt ?? 0;
    expect(lastAt).toBeGreaterThan(0);
    // Kết nối đang mở vẫn dùng được tới hết tuổi, cộng một giây cho độ trễ lan truyền.
    expect(lastAt - flaggedAt).toBeLessThan(READINESS_LIMIT_MS + CONNECTION_AGE_MS + 1_000);
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    expect((await pricingPods()).find((pod) => pod.name === name)?.restarts).toBe(restarts);
    await setPodReady(name, true);
    await sleep(READINESS_LIMIT_MS);
  });

  it('pod mới scale ra nhận tải trong 30 giây dù client dùng keep-alive', async () => {
    await resetStats();
    const before = new Set((await pricingPods()).map((pod) => pod.name));
    const traffic = startTraffic(20);

    await scalePricing(4);
    await sleep(30_000);
    await traffic.stop();

    const fresh = (await pricingPods()).filter((pod) => !before.has(pod.name));
    const stats = await orderStats();
    expect(fresh).toHaveLength(2);
    for (const pod of fresh) {
      expect(stats.byPod[pod.name]?.count ?? 0).toBeGreaterThan(0);
    }
    await scalePricing(2);
  });

  it('không giới hạn tuổi kết nối thì pod mới không nhận tải', async () => {
    await setConnectionAge(0);
    await resetStats();
    const before = new Set((await pricingPods()).map((pod) => pod.name));
    const traffic = startTraffic(20);
    await sleep(3_000);

    await scalePricing(4);
    await sleep(10_000);
    await traffic.stop();

    const fresh = (await pricingPods()).filter((pod) => !before.has(pod.name));
    const stats = await orderStats();
    expect(fresh.filter((pod) => stats.byPod[pod.name])).toHaveLength(0);
    await scalePricing(2);
    await setConnectionAge(CONNECTION_AGE_MS);
  });
});
