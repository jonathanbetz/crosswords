import { describe, it, expect } from 'vitest';
import {
  gradeOf,
  retrievability,
  computeSchedule,
  schedulePriority,
  NEW_CLUE_PRIORITY,
  TARGET_RETENTION
} from '../../lib/scheduler.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('gradeOf', () => {
  it('uses the explicit grade when present', () => {
    expect(gradeOf({ grade: 'hard', correct: true })).toBe('hard');
    expect(gradeOf({ grade: 'again', correct: false })).toBe('again');
  });

  it('falls back to correct for legacy attempts without a grade', () => {
    expect(gradeOf({ correct: true })).toBe('good');
    expect(gradeOf({ correct: false })).toBe('again');
  });
});

describe('retrievability', () => {
  it('is 1 immediately after review and decays over time', () => {
    expect(retrievability(DAY, 0)).toBe(1);
    // At exactly one stability-length elapsed, R equals the target retention.
    expect(retrievability(DAY, DAY)).toBeCloseTo(TARGET_RETENTION, 5);
    expect(retrievability(DAY, 10 * DAY)).toBeLessThan(0.4);
  });

  it('is 0 for an unseen clue (no stability)', () => {
    expect(retrievability(0, 100)).toBe(0);
  });
});

describe('computeSchedule', () => {
  const now = 2_000_000_000_000;

  it('reports a never-attempted clue as new', () => {
    const s = computeSchedule([], now);
    expect(s.total).toBe(0);
    expect(s.stability).toBe(0);
    expect(s.retrievability).toBe(null);
  });

  it('seeds a longer initial stability for a cold-correct (good) than a hinted (hard) than a miss (again)', () => {
    const good = computeSchedule([{ timestamp: now, grade: 'good' }], now);
    const hard = computeSchedule([{ timestamp: now, grade: 'hard' }], now);
    const again = computeSchedule([{ timestamp: now, grade: 'again' }], now);
    expect(good.stability).toBeGreaterThan(hard.stability);
    expect(hard.stability).toBeGreaterThan(again.stability);
    // Cold-correct should schedule roughly a day out; a miss only minutes.
    expect(good.stability).toBeGreaterThan(12 * HOUR);
    expect(again.stability).toBeLessThan(30 * MINUTE);
  });

  it('does not inflate stability from massed practice (drilling the same clue seconds apart)', () => {
    // Three good answers 2s apart — like a drilling session.
    const massed = [
      { timestamp: now, grade: 'good' },
      { timestamp: now + 2000, grade: 'good' },
      { timestamp: now + 4000, grade: 'good' }
    ];
    const s = computeSchedule(massed, now + 4000);
    const single = computeSchedule([{ timestamp: now, grade: 'good' }], now);
    // Reviewing something you just saw (R~1) yields almost no stability gain.
    expect(s.stability).toBeLessThan(single.stability * 1.1);
  });

  it('grows stability when a clue is recalled after a real gap', () => {
    const spaced = [
      { timestamp: now, grade: 'good' },
      { timestamp: now + 1 * DAY, grade: 'good' },
      { timestamp: now + 3 * DAY, grade: 'good' }
    ];
    const s = computeSchedule(spaced, now + 3 * DAY);
    expect(s.stability).toBeGreaterThan(1 * DAY);
  });

  it('shrinks stability on a lapse', () => {
    const before = computeSchedule([
      { timestamp: now, grade: 'good' },
      { timestamp: now + 1 * DAY, grade: 'good' }
    ], now + 1 * DAY);
    const afterLapse = computeSchedule([
      { timestamp: now, grade: 'good' },
      { timestamp: now + 1 * DAY, grade: 'good' },
      { timestamp: now + 5 * DAY, grade: 'again' }
    ], now + 5 * DAY);
    expect(afterLapse.stability).toBeLessThan(before.stability);
  });

  it('treats a legacy binary log the same as explicit good/again grades', () => {
    const legacy = computeSchedule([
      { timestamp: now, correct: true },
      { timestamp: now + 1 * DAY, correct: false }
    ], now + 1 * DAY);
    const graded = computeSchedule([
      { timestamp: now, grade: 'good' },
      { timestamp: now + 1 * DAY, grade: 'again' }
    ], now + 1 * DAY);
    expect(legacy.stability).toBeCloseTo(graded.stability, 5);
  });

  it('sorts attempts by timestamp before replaying', () => {
    const ordered = computeSchedule([
      { timestamp: now, grade: 'good' },
      { timestamp: now + 1 * DAY, grade: 'good' }
    ], now + 1 * DAY);
    const shuffled = computeSchedule([
      { timestamp: now + 1 * DAY, grade: 'good' },
      { timestamp: now, grade: 'good' }
    ], now + 1 * DAY);
    expect(shuffled.stability).toBeCloseTo(ordered.stability, 5);
    expect(shuffled.lastReviewTime).toBe(now + 1 * DAY);
  });
});

describe('schedulePriority', () => {
  const now = 2_000_000_000_000;

  it('gives never-attempted clues the highest priority', () => {
    const s = computeSchedule([], now);
    expect(schedulePriority(s, now)).toBe(NEW_CLUE_PRIORITY);
  });

  it('prioritizes a more-overdue clue over a freshly-reviewed one', () => {
    const fresh = computeSchedule([{ timestamp: now - MINUTE, grade: 'good' }], now);
    const overdue = computeSchedule([{ timestamp: now - 10 * DAY, grade: 'good' }], now);
    expect(schedulePriority(overdue, now)).toBeLessThan(schedulePriority(fresh, now));
  });

  it('keeps a just-answered clue out of the top of the queue', () => {
    const justNow = computeSchedule([{ timestamp: now, grade: 'good' }], now);
    // R ~ 1 right after review => priority near 1 (lowest urgency among seen clues).
    expect(schedulePriority(justNow, now)).toBeGreaterThan(0.9);
  });
});
