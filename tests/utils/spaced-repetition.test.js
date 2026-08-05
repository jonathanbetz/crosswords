import { describe, it, expect } from 'vitest';
import { selectWeightedFromTop, TOP_CANDIDATES_COUNT } from '../../lib/spaced-repetition.js';

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
    const clues = [{ priority: 0 }, { priority: 1 }, { priority: 2 }];
    const counts = [0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      counts[selectWeightedFromTop(clues)]++;
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });
});
