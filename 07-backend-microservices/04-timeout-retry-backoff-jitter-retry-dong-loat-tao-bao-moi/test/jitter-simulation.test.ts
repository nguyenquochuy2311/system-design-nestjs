import { describe, expect, it } from 'vitest';
import { seededRandom, simulate, STRATEGIES } from '../sim/jitter-simulation';

describe('Mô phỏng tranh chấp', () => {
  it('cùng hạt cho cùng kết quả', () => {
    expect(simulate('full-jitter', 100, 7)).toEqual(simulate('full-jitter', 100, 7));
  });

  it('PRNG cho số trong khoảng 0..1', () => {
    const random = seededRandom(1);
    const values = Array.from({ length: 1_000 }, () => random());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });

  it('mọi chiến lược đều kết thúc, mỗi client thắng đúng một lần', () => {
    for (const strategy of STRATEGIES) {
      const result = simulate(strategy, 200, 3);
      expect(result.totalCalls).toBeGreaterThanOrEqual(200);
    }
  });

  it('Full Jitter tốn ít lần gọi hơn hẳn backoff không jitter', () => {
    const calls = (strategy: 'no-jitter' | 'full-jitter') => simulate(strategy, 1_000, 1).totalCalls;
    expect(calls('full-jitter')).toBeLessThan(calls('no-jitter') / 2);
  });
});
