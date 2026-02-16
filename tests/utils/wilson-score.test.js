import { describe, it, expect } from 'vitest';
import { calculateWilsonLower } from '../../api/utils/wilson-score.js';

describe('calculateWilsonLower', () => {
  it('returns 0 when total is 0', () => {
    expect(calculateWilsonLower(0, 0)).toBe(0);
  });

  it('returns 0 when there are no successes', () => {
    expect(calculateWilsonLower(0, 10)).toBe(0);
  });

  it('returns a value less than the raw proportion', () => {
    // 7/10 = 0.7, Wilson lower bound should be less than 0.7
    const result = calculateWilsonLower(7, 10);
    expect(result).toBeLessThan(0.7);
    expect(result).toBeGreaterThan(0);
  });

  it('increases with more successes at the same total', () => {
    const low = calculateWilsonLower(3, 10);
    const high = calculateWilsonLower(8, 10);
    expect(high).toBeGreaterThan(low);
  });

  it('converges toward the raw proportion with more samples', () => {
    // With large sample sizes, Wilson lower bound approaches the raw proportion
    const smallSample = calculateWilsonLower(7, 10);   // 70%
    const largeSample = calculateWilsonLower(700, 1000); // 70%

    const rawProportion = 0.7;
    const smallGap = rawProportion - smallSample;
    const largeGap = rawProportion - largeSample;

    expect(largeGap).toBeLessThan(smallGap);
  });

  it('returns a value close to 1 for perfect score with many attempts', () => {
    const result = calculateWilsonLower(100, 100);
    expect(result).toBeGreaterThan(0.95);
  });

  it('handles 1 success out of 1 total', () => {
    const result = calculateWilsonLower(1, 1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('handles 0 successes out of 1 total', () => {
    const result = calculateWilsonLower(0, 1);
    expect(result).toBe(0);
  });
});
