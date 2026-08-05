import { describe, it, expect } from 'vitest';

// Mirror of the session selection algorithm in public/quiz.js — kept in sync by
// hand. Tested here as pure functions since quiz.js is a non-module browser
// script that can't be imported directly.

function orderByPuzzleLayers(scored) {
  const byPuzzle = new Map();
  for (const item of scored) {
    const date = item.clue.puzzleDate;
    if (!byPuzzle.has(date)) byPuzzle.set(date, []);
    byPuzzle.get(date).push(item);
  }
  const groups = Array.from(byPuzzle.values());
  const ordered = [];
  let layer = 0;
  let added = true;
  while (added) {
    added = false;
    const layerItems = [];
    for (const g of groups) {
      if (layer < g.length) { layerItems.push(g[layer]); added = true; }
    }
    layerItems.sort((a, b) => a.priority - b.priority);
    ordered.push(...layerItems);
    layer++;
  }
  return ordered;
}

function selectSessionClues(scored, sessionSize, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const cooldownMs = opts.cooldownMs || 0;
  const rand = opts.random || Math.random;

  const isFresh = it =>
    !cooldownMs || !it.lastAttemptTime || (now - it.lastAttemptTime) >= cooldownMs;

  const fresh = scored.filter(isFresh);
  const stale = scored.filter(it => !isFresh(it));
  const ordered = orderByPuzzleLayers(fresh).concat(orderByPuzzleLayers(stale));

  const poolSize = Math.min(sessionSize * 3, ordered.length);
  const pool = ordered.slice(0, poolSize);
  const weights = pool.map((_, i) => Math.max(1, poolSize - i));

  const remaining = pool.slice();
  const remainingWeights = weights.slice();
  const selected = [];
  const usedPuzzles = new Set();
  const count = Math.min(sessionSize, ordered.length);

  while (selected.length < count && remaining.length > 0) {
    let candidateIdx = [];
    for (let i = 0; i < remaining.length; i++) {
      if (!usedPuzzles.has(remaining[i].clue.puzzleDate)) candidateIdx.push(i);
    }
    if (candidateIdx.length === 0) {
      usedPuzzles.clear();
      candidateIdx = remaining.map((_, i) => i);
    }

    const totalW = candidateIdx.reduce((s, i) => s + remainingWeights[i], 0);
    let r = rand() * totalW;
    let pick = candidateIdx[candidateIdx.length - 1];
    for (const i of candidateIdx) {
      r -= remainingWeights[i];
      if (r <= 0) { pick = i; break; }
    }

    selected.push(remaining[pick].clue);
    usedPuzzles.add(remaining[pick].clue.puzzleDate);
    remaining.splice(pick, 1);
    remainingWeights.splice(pick, 1);
  }

  return selected;
}

function makeScored(puzzleDates, cluesPerPuzzle = 3, lastAttemptTime = 0) {
  const items = [];
  for (const date of puzzleDates) {
    for (let c = 0; c < cluesPerPuzzle; c++) {
      items.push({
        clue: { puzzleDate: date, key: `${date}:clue-${c}` },
        priority: Math.random(),
        lastAttemptTime
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

  it('returns one clue per puzzle when there are at least sessionSize puzzles', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `puzzle-${i}`);
    const scored = makeScored(dates, 10);

    for (let trial = 0; trial < 10; trial++) {
      const selected = selectSessionClues(scored, 5);
      const uniqueDates = new Set(selected.map(c => c.puzzleDate));
      expect(uniqueDates.size).toBe(selected.length);
    }
  });

  it('fills the session with extra clues per puzzle when fewer puzzles than sessionSize', () => {
    // 12 puzzles, 4 clues each = 48 clues. A 20-clue session must fill to 20
    // (Fix 2) by allowing more than one clue per puzzle, spread as evenly as
    // possible (each puzzle used at most twice: ceil(20/12) = 2).
    const dates = Array.from({ length: 12 }, (_, i) => `puzzle-${i}`);
    const scored = makeScored(dates, 4);
    const selected = selectSessionClues(scored, 20);
    expect(selected.length).toBe(20);
    // No duplicate clue keys.
    expect(new Set(selected.map(c => c.key)).size).toBe(20);
    const perPuzzle = {};
    for (const c of selected) perPuzzle[c.puzzleDate] = (perPuzzle[c.puzzleDate] || 0) + 1;
    expect(Math.max(...Object.values(perPuzzle))).toBeLessThanOrEqual(2);
  });

  it('is capped by total available clues when clues are scarce', () => {
    const dates = Array.from({ length: 3 }, (_, i) => `puzzle-${i}`);
    const scored = makeScored(dates, 2); // 6 clues total
    const selected = selectSessionClues(scored, 20);
    expect(selected.length).toBe(6);
    expect(new Set(selected.map(c => c.key)).size).toBe(6);
  });

  it('distributes across puzzles even when one puzzle dominates priority scores', () => {
    const items = [];
    for (let c = 0; c < 30; c++) {
      items.push({ clue: { puzzleDate: 'puzzle-0', key: `puzzle-0:clue-${c}` }, priority: -1000 + c, lastAttemptTime: 0 });
    }
    for (let p = 1; p <= 30; p++) {
      items.push({ clue: { puzzleDate: `puzzle-${p}`, key: `puzzle-${p}:clue-0` }, priority: p * 10, lastAttemptTime: 0 });
    }
    items.sort((a, b) => a.priority - b.priority);

    for (let trial = 0; trial < 10; trial++) {
      const selected = selectSessionClues(items, 20);
      const dates = selected.map(c => c.puzzleDate);
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates.filter(d => d === 'puzzle-0').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('selectSessionClues cooldown', () => {
  const now = 1_000_000_000_000;
  const COOLDOWN = 45 * 60 * 1000;

  it('excludes clues attempted within the cooldown window', () => {
    // 25 puzzles: 15 drilled 5 min ago (within cooldown), 10 untouched.
    const recentDates = Array.from({ length: 15 }, (_, i) => `recent-${i}`);
    const freshDates = Array.from({ length: 10 }, (_, i) => `fresh-${i}`);
    const scored = [
      ...makeScored(recentDates, 3, now - 5 * 60 * 1000),
      ...makeScored(freshDates, 3, 0)
    ].sort((a, b) => a.priority - b.priority);

    const selected = selectSessionClues(scored, 8, { now, cooldownMs: COOLDOWN });
    // A full session of 8 can be built entirely from the 10 fresh puzzles.
    expect(selected.length).toBe(8);
    for (const c of selected) expect(c.puzzleDate.startsWith('fresh-')).toBe(true);
  });

  it('does not re-serve clues drilled in the immediately prior session', () => {
    // Simulate: 30 puzzles worth of clues; a prior session drilled 20 of them
    // just now. A new session must avoid those 20.
    const dates = Array.from({ length: 30 }, (_, i) => `p-${i}`);
    const scored = makeScored(dates, 5, 0);
    const priorSession = selectSessionClues(scored, 20, { now, cooldownMs: COOLDOWN });
    const drilledKeys = new Set(priorSession.map(c => c.key));

    // Mark drilled clues as just-attempted.
    const afterDrill = scored.map(it =>
      drilledKeys.has(it.clue.key) ? { ...it, lastAttemptTime: now } : it
    );

    const nextSession = selectSessionClues(afterDrill, 20, { now: now + 60_000, cooldownMs: COOLDOWN });
    const overlap = nextSession.filter(c => drilledKeys.has(c.key)).length;
    expect(overlap).toBe(0);
  });

  it('relaxes the cooldown when too few fresh clues remain to fill a session', () => {
    // Only 6 clues total, all attempted within cooldown. Rather than return an
    // empty/tiny session, it falls back to the cooled-down clues.
    const dates = Array.from({ length: 6 }, (_, i) => `p-${i}`);
    const scored = makeScored(dates, 1, now - 60_000);
    const selected = selectSessionClues(scored, 20, { now, cooldownMs: COOLDOWN });
    expect(selected.length).toBe(6);
  });
});
