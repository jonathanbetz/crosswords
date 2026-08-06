import { describe, it, expect } from 'vitest';

// Mirror of the session-retirement logic in public/quiz.js — kept in sync by
// hand, since quiz.js is a non-module browser script that can't be imported.
// The key invariant under test: a clue only advances toward retirement on a
// genuinely-correct answer (all letters right AND no hint used), never on a
// hint-assisted one. This mirrors what checkAnswer() passes to
// recordSessionAttempt(): `countAsCorrect = allCorrect && !hintUsed`.

const SESSION_CORRECT_REQUIRED = 3;
const SESSION_SPACING = 10;

// The app's definition of a "correct" answer for streak/stats/retirement.
function countAsCorrect(allCorrect, hintUsed) {
  return allCorrect && !hintUsed;
}

// Mirror of recordSessionAttempt(sessionClue, countAsCorrect).
function recordSessionAttempt(session, sessionClue, count) {
  session.totalAttempts++;
  if (count) {
    sessionClue.correctCount++;
    sessionClue.nextEligibleAt = session.totalAttempts + SESSION_SPACING;
    if (sessionClue.correctCount >= SESSION_CORRECT_REQUIRED) {
      sessionClue.retired = true;
    }
  } else {
    sessionClue.nextEligibleAt = session.totalAttempts + 2;
  }
}

// Drive a clue through a list of [allCorrect, hintUsed] answers the way
// checkAnswer() would, and return the resulting session-clue state.
function replay(answers) {
  const session = { totalAttempts: 0 };
  const sessionClue = { correctCount: 0, nextEligibleAt: 0, retired: false };
  for (const [allCorrect, hintUsed] of answers) {
    recordSessionAttempt(session, sessionClue, countAsCorrect(allCorrect, hintUsed));
  }
  return sessionClue;
}

describe('session retirement', () => {
  it('retires a clue after three unaided correct answers', () => {
    const sc = replay([[true, false], [true, false], [true, false]]);
    expect(sc.correctCount).toBe(3);
    expect(sc.retired).toBe(true);
  });

  it('does NOT retire a clue answered correctly only with hints', () => {
    const sc = replay([[true, true], [true, true], [true, true], [true, true]]);
    expect(sc.correctCount).toBe(0);
    expect(sc.retired).toBe(false);
  });

  it('does not count a hint-assisted correct toward the required total', () => {
    // good, hinted, good, good — only three of the four are unaided.
    const sc = replay([[true, false], [true, true], [true, false], [true, false]]);
    expect(sc.correctCount).toBe(3);
    expect(sc.retired).toBe(true);
  });

  it('leaves a clue short of retirement when a hint replaces one unaided correct', () => {
    // good, good, hinted — two real corrects, so not retired.
    const sc = replay([[true, false], [true, false], [true, true]]);
    expect(sc.correctCount).toBe(2);
    expect(sc.retired).toBe(false);
  });

  it('does not retire on wrong answers', () => {
    const sc = replay([[false, false], [false, false], [false, false]]);
    expect(sc.correctCount).toBe(0);
    expect(sc.retired).toBe(false);
  });

  it('re-queues a hint-assisted answer soon (spacing of a miss, not a correct)', () => {
    const session = { totalAttempts: 0 };
    const sc = { correctCount: 0, nextEligibleAt: 0, retired: false };
    recordSessionAttempt(session, sc, countAsCorrect(true, true));
    // Miss-style requeue is totalAttempts + 2, not + SESSION_SPACING.
    expect(sc.nextEligibleAt).toBe(session.totalAttempts + 2);
  });
});
