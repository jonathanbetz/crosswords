import { describe, it, expect } from 'vitest';

// Mirrors of the pure sync-decision helpers in public/quiz.js — kept in sync by
// hand, since quiz.js is a non-module browser script and can't be imported.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FULL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function decideSyncStrategy({ force, sameMode, lastSync, lastFullSync, now,
  syncIntervalMs = SYNC_INTERVAL_MS, fullSyncIntervalMs = FULL_SYNC_INTERVAL_MS }) {
  if (!force && sameMode && (now - lastSync) < syncIntervalMs) {
    return { skip: true, useIncremental: false };
  }
  const fullSyncDue = force || !sameMode || lastFullSync === 0
    || (now - lastFullSync) >= fullSyncIntervalMs;
  return { skip: false, useIncremental: !fullSyncDue && lastSync > 0 };
}

function reconcileSessionClues(sessionClues, validKeys) {
  return sessionClues.filter(sc => validKeys.has(sc.clue.key));
}

function mergeAttempts(existing, incoming) {
  const byTs = new Map();
  for (const a of existing || []) byTs.set(a.timestamp, a);
  for (const a of incoming || []) if (!byTs.has(a.timestamp)) byTs.set(a.timestamp, a);
  return Array.from(byTs.values()).sort((x, y) => x.timestamp - y.timestamp);
}

describe('decideSyncStrategy', () => {
  const now = 10 * 60 * 1000;

  it('does a full sync on first load (no prior full sync)', () => {
    const r = decideSyncStrategy({ force: false, sameMode: true, lastSync: 0, lastFullSync: 0, now });
    expect(r.skip).toBe(false);
    expect(r.useIncremental).toBe(false);
  });

  it('skips when data is fresh in the same mode', () => {
    const r = decideSyncStrategy({
      force: false, sameMode: true,
      lastSync: now - 60 * 1000, lastFullSync: now - 60 * 1000, now
    });
    expect(r.skip).toBe(true);
  });

  it('does an incremental sync when past sync interval but full data is still fresh', () => {
    const r = decideSyncStrategy({
      force: false, sameMode: true,
      lastSync: now - (SYNC_INTERVAL_MS + 1000), // due for a sync
      lastFullSync: now - 60 * 1000,             // full data still fresh
      now
    });
    expect(r.skip).toBe(false);
    expect(r.useIncremental).toBe(true);
  });

  it('does a full sync once the full-sync interval elapses, pruning ignored clues', () => {
    const r = decideSyncStrategy({
      force: false, sameMode: true,
      lastSync: now - (SYNC_INTERVAL_MS + 1000),
      lastFullSync: now - (FULL_SYNC_INTERVAL_MS + 1000), // full data stale
      now
    });
    expect(r.skip).toBe(false);
    expect(r.useIncremental).toBe(false);
  });

  it('forces a full sync (never skips, never incremental) when force is true', () => {
    const r = decideSyncStrategy({
      force: true, sameMode: true,
      lastSync: now - 1000, lastFullSync: now - 1000, now
    });
    expect(r.skip).toBe(false);
    expect(r.useIncremental).toBe(false);
  });

  it('does a full sync when the mode changed, even if data is recent', () => {
    const r = decideSyncStrategy({
      force: false, sameMode: false,
      lastSync: now - 1000, lastFullSync: now - 1000, now
    });
    expect(r.skip).toBe(false);
    expect(r.useIncremental).toBe(false);
  });
});

describe('reconcileSessionClues', () => {
  const makeSession = (keys) => keys.map(k => ({ clue: { key: k }, retired: false }));

  it('drops session clues whose key no longer exists locally', () => {
    const session = makeSession(['a', 'b', 'c']);
    const valid = new Set(['a', 'c']); // 'b' was ignored/removed on the server
    const result = reconcileSessionClues(session, valid);
    expect(result.map(sc => sc.clue.key)).toEqual(['a', 'c']);
  });

  it('keeps every clue when all still exist', () => {
    const session = makeSession(['a', 'b']);
    const result = reconcileSessionClues(session, new Set(['a', 'b']));
    expect(result).toHaveLength(2);
  });

  it('removes all clues when none remain valid', () => {
    const session = makeSession(['a', 'b']);
    const result = reconcileSessionClues(session, new Set());
    expect(result).toHaveLength(0);
  });
});

describe('mergeAttempts', () => {
  it('keeps local attempts the server snapshot has not caught up with', () => {
    // The bug: a full sync overwrote local attempts with a server snapshot that
    // was missing a just-recorded (still-pending) attempt, rolling it back and
    // making the clue eligible again. Merge must preserve the local attempt.
    const server = [{ timestamp: 100, correct: true }];
    const local = [{ timestamp: 100, correct: true }, { timestamp: 200, correct: true }];
    const merged = mergeAttempts(local, server);
    expect(merged).toHaveLength(2);
    expect(merged.map(a => a.timestamp)).toEqual([100, 200]);
  });

  it('adds server attempts not present locally', () => {
    const local = [{ timestamp: 100, correct: true }];
    const server = [{ timestamp: 100, correct: true }, { timestamp: 300, correct: false }];
    const merged = mergeAttempts(local, server);
    expect(merged.map(a => a.timestamp)).toEqual([100, 300]);
  });

  it('dedupes by timestamp and returns chronological order', () => {
    const a = [{ timestamp: 300, correct: true }, { timestamp: 100, correct: true }];
    const b = [{ timestamp: 200, correct: false }, { timestamp: 300, correct: true }];
    const merged = mergeAttempts(a, b);
    expect(merged.map(x => x.timestamp)).toEqual([100, 200, 300]);
  });

  it('never shrinks below the larger input (append-only union)', () => {
    const local = [{ timestamp: 1 }, { timestamp: 2 }, { timestamp: 3 }];
    const server = [{ timestamp: 1 }];
    expect(mergeAttempts(local, server).length).toBeGreaterThanOrEqual(local.length);
  });

  it('handles empty/undefined inputs', () => {
    expect(mergeAttempts(undefined, undefined)).toEqual([]);
    expect(mergeAttempts([], [{ timestamp: 5, correct: true }]).map(a => a.timestamp)).toEqual([5]);
  });
});
