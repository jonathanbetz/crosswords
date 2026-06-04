import { describe, it, expect } from 'vitest';

// Mirror of the session selection algorithm in public/quiz.js — kept in sync by hand.
// Tested here as a pure function since quiz.js is a non-module browser script.
function selectSessionClues(scored, sessionSize) {
  const bestByPuzzle = new Map();
  for (const item of scored) {
    if (!bestByPuzzle.has(item.clue.puzzleDate)) {
      bestByPuzzle.set(item.clue.puzzleDate, item);
    }
  }
  const puzzleReps = Array.from(bestByPuzzle.values());
  puzzleReps.sort((a, b) => a.priority - b.priority);

  const poolSize = Math.min(sessionSize * 3, puzzleReps.length);
  const pool = puzzleReps.slice(0, poolSize);
  const weights = pool.map((_, i) => Math.max(1, poolSize - i));

  const remaining = pool.slice();
  const remainingWeights = weights.slice();
  const selected = [];
  const count = Math.min(sessionSize, puzzleReps.length);

  while (selected.length < count && remaining.length > 0) {
    const totalW = remainingWeights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalW;
    let pick = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      rand -= remainingWeights[i];
      if (rand <= 0) { pick = i; break; }
    }
    selected.push(remaining[pick].clue);
    remaining.splice(pick, 1);
    remainingWeights.splice(pick, 1);
  }

  return selected;
}

function makeScored(puzzleDates, cluesPerPuzzle = 3) {
  const items = [];
  for (const date of puzzleDates) {
    for (let c = 0; c < cluesPerPuzzle; c++) {
      items.push({
        clue: { puzzleDate: date, key: `${date}:clue-${c}` },
        priority: Math.random()
      });
    }
  }
  items.sort((a, b) => a.priority - b.priority);
  return items;
}

describe('selectSessionClues', () => {
  it('selects clues from 20 distinct puzzles when enough puzzles are available', () => {
    const dates = Array.from({ length: 40 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
    const scored = makeScored(dates, 3);

    for (let trial = 0; trial < 20; trial++) {
      const selected = selectSessionClues(scored, 20);
      const uniqueDates = new Set(selected.map(c => c.puzzleDate));
      expect(uniqueDates.size).toBe(selected.length);
      expect(selected.length).toBe(20);
    }
  });

  it('returns at most one clue per puzzle even when many clues share a puzzle', () => {
    const dates = Array.from({ length: 5 }, (_, i) => `puzzle-${i}`);
    const scored = makeScored(dates, 10);

    for (let trial = 0; trial < 10; trial++) {
      const selected = selectSessionClues(scored, 5);
      const uniqueDates = new Set(selected.map(c => c.puzzleDate));
      expect(uniqueDates.size).toBe(selected.length);
    }
  });

  it('caps session size at number of distinct puzzles when fewer puzzles than sessionSize', () => {
    const dates = Array.from({ length: 12 }, (_, i) => `puzzle-${i}`);
    const scored = makeScored(dates, 4);
    const selected = selectSessionClues(scored, 20);
    expect(selected.length).toBe(12);
    const uniqueDates = new Set(selected.map(c => c.puzzleDate));
    expect(uniqueDates.size).toBe(12);
  });

  it('distributes across puzzles even when one puzzle dominates priority scores', () => {
    // All clues from puzzle-0 have the best (lowest) priority scores
    const items = [];
    for (let c = 0; c < 30; c++) {
      items.push({ clue: { puzzleDate: 'puzzle-0', key: `puzzle-0:clue-${c}` }, priority: -1000 + c });
    }
    for (let p = 1; p <= 30; p++) {
      items.push({ clue: { puzzleDate: `puzzle-${p}`, key: `puzzle-${p}:clue-0` }, priority: p * 10 });
    }
    items.sort((a, b) => a.priority - b.priority);

    for (let trial = 0; trial < 10; trial++) {
      const selected = selectSessionClues(items, 20);
      const dates = selected.map(c => c.puzzleDate);
      const uniqueDates = new Set(dates);
      expect(uniqueDates.size).toBe(dates.length);
      // puzzle-0 contributes at most one clue despite having 30 top-priority candidates
      expect(dates.filter(d => d === 'puzzle-0').length).toBeLessThanOrEqual(1);
    }
  });
});
