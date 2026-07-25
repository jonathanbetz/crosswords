import { describe, it, expect, vi } from 'vitest';
import {
  calculateMinInterval,
  calculatePriority,
  selectWeightedFromTop,
  TOP_CANDIDATES_COUNT
} from '../../lib/spaced-repetition.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('calculateMinInterval', () => {
  it('returns 0 for a clue that has never been seen', () => {
    expect(calculateMinInterval(0, 0)).toBe(0);
  });

  it('returns a positive interval for a clue with attempts', () => {
    expect(calculateMinInterval(0.5, 5)).toBeGreaterThan(0);
  });

  it('returns a longer interval for higher Wilson scores', () => {
    const low = calculateMinInterval(0.2, 5);
    const high = calculateMinInterval(0.8, 5);
    expect(high).toBeGreaterThan(low);
  });

  it('returns a longer interval with more attempts at same Wilson score', () => {
    const few = calculateMinInterval(0.7, 3);
    const many = calculateMinInterval(0.7, 10);
    expect(many).toBeGreaterThan(few);
  });

  it('caps attempt bonus at 10 attempts', () => {
    const atCap = calculateMinInterval(0.7, 10);
    const beyond = calculateMinInterval(0.7, 100);
    expect(beyond).toBe(atCap);
  });

  it('returns at least 1 minute for any seen clue', () => {
    expect(calculateMinInterval(0, 1)).toBeGreaterThanOrEqual(MINUTE);
  });

  it('returns a very long interval for a high Wilson score with many attempts', () => {
    // wilson=0.99, total=20 yields a long interval due to attempt bonus
    // The algorithm doesn't hard-cap at 4h; the 4h figure is the base max before attempt bonus
    const max = calculateMinInterval(0.99, 20);
    expect(max).toBeGreaterThan(4 * HOUR);
    expect(max).toBeLessThan(12 * HOUR); // sanity ceiling
  });
});

describe('calculatePriority', () => {
  const now = Date.now();

  it('returns -1000 for a clue that has never been attempted', () => {
    expect(calculatePriority(0, 0, 0, now)).toBe(-1000);
  });

  it('returns a high priority (low score) for a clue past its minimum interval', () => {
    // Low Wilson score, last attempt was 2 hours ago
    const lastAttemptTime = now - 2 * HOUR;
    const priority = calculatePriority(0.1, 3, lastAttemptTime, now);
    expect(priority).toBeLessThan(0.5);
  });

  it('returns a deprioritized score (>1000) for a clue within its minimum interval', () => {
    // High Wilson score means long interval; simulate last attempt 1 minute ago
    const lastAttemptTime = now - MINUTE;
    const priority = calculatePriority(0.9, 10, lastAttemptTime, now);
    expect(priority).toBeGreaterThan(1000);
  });

  it('gives higher priority (lower score) to low-Wilson clues than high-Wilson clues when both are overdue', () => {
    const lastAttemptTime = now - 10 * HOUR; // Both overdue
    const lowWilson = calculatePriority(0.1, 5, lastAttemptTime, now);
    const highWilson = calculatePriority(0.9, 5, lastAttemptTime, now);
    expect(lowWilson).toBeLessThan(highWilson);
  });

  it('remaining-ratio is 1 when last attempt was just now (no time elapsed)', () => {
    const priority = calculatePriority(0.5, 5, now, now);
    // timeSinceLastAttempt = 0, minInterval > 0, remainingRatio = 1
    expect(priority).toBe(2000);
  });

  it('overdue penalty is capped so that priority cannot go below wilsonLower - 0.5', () => {
    // The penalty caps at min(overdueRatio - 1, 5) * 0.1 = 0.5
    // So priority floor = wilsonLower - 0.5
    // With wilson=0.5, floor = 0.0; any amount overdue past ~6x should give the same priority
    const lastAttemptTime100x = now - 100 * HOUR;
    const lastAttemptTime200x = now - 200 * HOUR;
    const p100x = calculatePriority(0.5, 5, lastAttemptTime100x, now);
    const p200x = calculatePriority(0.5, 5, lastAttemptTime200x, now);
    expect(p100x).toBe(p200x);
  });
});

describe('selectWeightedFromTop', () => {
  it('always returns a valid index within the list', () => {
    const clues = [{ priority: 0 }, { priority: 1 }, { priority: 2 }];
    for (let i = 0; i < 50; i++) {
      const idx = selectWeightedFromTop(clues);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(clues.length);
    }
  });

  it('returns 0 for a single-element list', () => {
    expect(selectWeightedFromTop([{ priority: 0 }])).toBe(0);
  });

  it('respects TOP_CANDIDATES_COUNT cap', () => {
    // Even with 20 clues, selection must be within top 5
    const clues = Array.from({ length: 20 }, (_, i) => ({ priority: i }));
    for (let i = 0; i < 100; i++) {
      const idx = selectWeightedFromTop(clues);
      expect(idx).toBeLessThan(TOP_CANDIDATES_COUNT);
    }
  });

  it('favors index 0 (highest priority) over later indices', () => {
    // Run many trials and count how often index 0 is selected
    const clues = [{ priority: 0 }, { priority: 1 }, { priority: 2 }];
    const counts = [0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      counts[selectWeightedFromTop(clues)]++;
    }
    // Index 0 should be selected most often (weight 3 vs 2 vs 1 = 50% expected)
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });
});
