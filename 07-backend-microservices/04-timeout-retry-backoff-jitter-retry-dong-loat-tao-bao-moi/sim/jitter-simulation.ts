/**
 * Mô phỏng tranh chấp theo cách của Brooker: N client cùng cần ghi một lần vào tài nguyên chỉ phục vụ một lời gọi mỗi khe.
 * Nhiều lời gọi rơi vào cùng khe thì một lời gọi thắng, còn lại thất bại và thử lại theo chiến lược. Không cần hạ tầng.
 *   pnpm sim:jitter            # in bảng; ghi bench/results/sim/jitter.json
 *   pnpm sim:jitter --clients 1000 --seeds 20
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export type Strategy = 'no-jitter' | 'equal-jitter' | 'full-jitter' | 'decorrelated-jitter';

export const STRATEGIES: Strategy[] = ['no-jitter', 'equal-jitter', 'full-jitter', 'decorrelated-jitter'];

const BASE_SLOTS = 2;
const CAP_SLOTS = 4_096;

/** PRNG có hạt để lượt chạy lặp lại được (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function nextDelay(strategy: Strategy, attempt: number, previous: number, random: () => number): number {
  const ceiling = Math.min(CAP_SLOTS, BASE_SLOTS * 2 ** attempt);
  switch (strategy) {
    case 'no-jitter':
      return ceiling;
    case 'equal-jitter':
      return ceiling / 2 + random() * (ceiling / 2);
    case 'full-jitter':
      return random() * ceiling;
    case 'decorrelated-jitter':
      return Math.min(CAP_SLOTS, BASE_SLOTS + random() * (previous * 3 - BASE_SLOTS));
  }
}

export interface SimulationResult {
  totalCalls: number;
  completionSlots: number;
}

export function simulate(strategy: Strategy, clients: number, seed: number): SimulationResult {
  const random = seededRandom(seed);
  const attempts = new Map<number, { id: number; attempt: number; previous: number }[]>();
  const schedule = (slot: number, entry: { id: number; attempt: number; previous: number }) => {
    attempts.set(slot, [...(attempts.get(slot) ?? []), entry]);
  };
  for (let id = 0; id < clients; id += 1) {
    schedule(0, { id, attempt: 0, previous: BASE_SLOTS });
  }

  let done = 0;
  let totalCalls = 0;
  let slot = 0;
  while (done < clients) {
    const entries = attempts.get(slot);
    if (entries) {
      attempts.delete(slot);
      totalCalls += entries.length;
      done += 1;
      // Lời gọi đầu trong khe thắng; thứ tự không ảnh hưởng vì các client như nhau.
      for (const entry of entries.slice(1)) {
        const delay = nextDelay(strategy, entry.attempt, entry.previous, random);
        schedule(slot + 1 + Math.floor(delay), { id: entry.id, attempt: entry.attempt + 1, previous: Math.max(delay, BASE_SLOTS) });
      }
    }
    slot += 1;
  }
  return { totalCalls, completionSlots: slot };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

if (process.argv[1]?.endsWith('jitter-simulation.ts')) {
  const { values } = parseArgs({
    options: { clients: { type: 'string', default: '1000' }, seeds: { type: 'string', default: '20' } },
  });
  const clients = Number(values.clients);
  const seeds = Array.from({ length: Number(values.seeds) }, (_, index) => index + 1);
  const rows = STRATEGIES.map((strategy) => {
    const results = seeds.map((seed) => simulate(strategy, clients, seed));
    return {
      strategy,
      medianCalls: median(results.map((result) => result.totalCalls)),
      medianCompletionSlots: median(results.map((result) => result.completionSlots)),
    };
  });
  mkdirSync('bench/results/sim', { recursive: true });
  writeFileSync('bench/results/sim/jitter.json', JSON.stringify({ clients, seeds: seeds.length, rows }, null, 2));
  console.table(rows);
}
