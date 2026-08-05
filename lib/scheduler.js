// FSRS-lite spaced-repetition scheduler.
//
// Unlike the previous Wilson-lower-bound heuristic (which measured
// confidence-in-an-estimate, not memory strength, and could only ever produce
// minutes-to-hours intervals), this models each clue's memory as a *stability*
// that grows with successful, well-spaced recall and shrinks on a lapse. It is
// stateless: the current stability/difficulty/due-time are derived by replaying
// the clue's graded attempt log, so no extra per-clue state has to be stored or
// migrated. Kept in sync with the mirror in public/quiz.js.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Stability is expressed as the interval after which recall probability decays
// to TARGET_RETENTION, i.e. R(t) = TARGET_RETENTION ^ (t / stability).
export const TARGET_RETENTION = 0.9;

// Never-attempted clues sort ahead of everything else (highest priority).
export const NEW_CLUE_PRIORITY = -1000;

// Interval a clue earns from its very first attempt, by grade.
const INITIAL_STABILITY = { again: 10 * MINUTE, hard: 8 * HOUR, good: 1 * DAY };
const MIN_STABILITY = 5 * MINUTE;
const MAX_STABILITY = 365 * DAY;

// Difficulty in [0,1]; higher = harder, so it grows stability more slowly.
const INITIAL_DIFFICULTY = 0.3;
const DIFFICULTY_DELTA = { again: 0.15, hard: 0.05, good: -0.05 };

// Stability growth on a successful, spaced review. The gain scales with
// (1 - retrievability), so massed practice (answering the same clue seconds
// apart in a drilling session, where R ~ 1) barely moves stability, while
// recalling something you were about to forget moves it a lot.
const MAX_STABILITY_GAIN = 4;
const HARD_GAIN_FACTOR = 0.5; // a hinted (hard) success grows stability less
const LAPSE_RETENTION = 0.35; // fraction of stability kept after a miss

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// Grade of an attempt. New attempts carry an explicit grade; legacy attempts
// only have the binary `correct`, from which we infer good/again (a legacy
// hinted-but-right attempt was recorded as correct:false, so it reads as
// 'again' — the best available from old data, and self-correcting as graded
// attempts accumulate).
export function gradeOf(attempt) {
  if (attempt && attempt.grade) return attempt.grade;
  return attempt && attempt.correct ? 'good' : 'again';
}

// Probability of recall for a clue with the given stability after `elapsed` ms.
export function retrievability(stability, elapsed) {
  if (stability <= 0) return 0;
  if (elapsed <= 0) return 1;
  return Math.pow(TARGET_RETENTION, elapsed / stability);
}

// Replay a clue's attempt log into its current memory state.
export function computeSchedule(attempts, now) {
  const list = (attempts || [])
    .filter(a => a && typeof a.timestamp === 'number')
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const total = list.length;
  if (total === 0) {
    return {
      total: 0, correct: 0,
      stability: 0, difficulty: INITIAL_DIFFICULTY,
      lastReviewTime: 0, dueTime: 0, retrievability: null
    };
  }

  let stability = 0;
  let difficulty = INITIAL_DIFFICULTY;
  let lastTime = 0;
  let correct = 0;

  for (const a of list) {
    const g = gradeOf(a);
    if (g !== 'again') correct++;

    if (stability === 0) {
      // First exposure: seed stability and difficulty from the grade.
      stability = INITIAL_STABILITY[g] != null ? INITIAL_STABILITY[g] : INITIAL_STABILITY.good;
      difficulty = clamp01(INITIAL_DIFFICULTY + (DIFFICULTY_DELTA[g] || 0));
    } else {
      const elapsed = Math.max(0, a.timestamp - lastTime);
      const R = retrievability(stability, elapsed);
      difficulty = clamp01(difficulty + (DIFFICULTY_DELTA[g] || 0));

      if (g === 'again') {
        stability = Math.max(MIN_STABILITY, stability * LAPSE_RETENTION);
      } else {
        const gradeFactor = g === 'hard' ? HARD_GAIN_FACTOR : 1;
        const gain = MAX_STABILITY_GAIN * (1 - difficulty) * gradeFactor * (1 - R);
        stability = Math.min(MAX_STABILITY, stability * (1 + gain));
      }
    }
    lastTime = a.timestamp;
  }

  return {
    total,
    correct,
    stability,
    difficulty,
    lastReviewTime: lastTime,
    dueTime: lastTime + stability,
    retrievability: retrievability(stability, Math.max(0, now - lastTime))
  };
}

// Selection priority: lower = show sooner. Never-attempted clues get the
// highest priority; otherwise the least-retrievable (most overdue) clue wins,
// so review effort lands on what you're about to forget. Result is in
// [0,1] for attempted clues, or NEW_CLUE_PRIORITY for new ones — a scale the
// existing top-N weighted samplers consume unchanged.
export function schedulePriority(schedule, now) {
  if (!schedule || schedule.total === 0) return NEW_CLUE_PRIORITY;
  return retrievability(schedule.stability, Math.max(0, now - schedule.lastReviewTime));
}
