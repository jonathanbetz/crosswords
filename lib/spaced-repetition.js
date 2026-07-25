import { calculateWilsonLower } from './wilson-score.js';

export const TOP_CANDIDATES_COUNT = 5;

// Calculate minimum interval before showing a clue again based on Wilson score
// Higher Wilson score = longer interval (more confident it's learned)
// Returns interval in milliseconds
export function calculateMinInterval(wilsonLower, total) {
  if (total === 0) {
    // Never seen - no minimum interval
    return 0;
  }

  // Base intervals in minutes, scaled by Wilson score
  // Wilson 0.0 = 1 minute minimum
  // Wilson 0.5 = 10 minutes minimum
  // Wilson 0.8 = 1 hour minimum
  // Wilson 0.95+ = 4 hours minimum

  const baseMinutes = 1;
  const maxMinutes = 240; // 4 hours

  // Exponential scaling: interval grows faster as Wilson score increases
  const scaleFactor = Math.pow(wilsonLower, 2) * maxMinutes + baseMinutes;

  // Factor in total attempts - more attempts with high success = longer interval
  const attemptBonus = Math.min(total / 10, 1); // caps at 10 attempts
  const adjustedMinutes = scaleFactor * (1 + attemptBonus * wilsonLower);

  return adjustedMinutes * 60 * 1000; // Convert to milliseconds
}

// Calculate priority score for spaced repetition
// Lower score = higher priority (should be shown sooner)
export function calculatePriority(wilsonLower, total, lastAttemptTime, now) {
  if (total === 0) {
    // Never attempted - highest priority
    return -1000;
  }

  const minInterval = calculateMinInterval(wilsonLower, total);
  const timeSinceLastAttempt = now - lastAttemptTime;

  // If we haven't waited long enough, deprioritize significantly
  if (timeSinceLastAttempt < minInterval) {
    // How much of the interval remains (0 to 1)
    const remainingRatio = (minInterval - timeSinceLastAttempt) / minInterval;
    // Push to back of queue - higher remaining ratio = lower priority
    return 1000 + remainingRatio * 1000;
  }

  // Past minimum interval - priority based on Wilson score
  // Lower Wilson = higher priority (shown sooner)
  // Also factor in how much we've exceeded the interval
  const overdueRatio = timeSinceLastAttempt / minInterval;
  const overduePenalty = Math.min(overdueRatio - 1, 5) * 0.1; // caps at 0.5 reduction

  return wilsonLower - overduePenalty;
}

// Weighted random selection from the top N candidates by priority
// Returns the selected index into cluesWithScores
export function selectWeightedFromTop(cluesWithScores) {
  const topCount = Math.min(TOP_CANDIDATES_COUNT, cluesWithScores.length);
  const weights = [];
  for (let i = 0; i < topCount; i++) {
    weights.push(topCount - i); // Higher weight for higher priority (lower index)
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < topCount; i++) {
    rand -= weights[i];
    if (rand <= 0) return i;
  }
  return 0;
}

// Score and sort clues by spaced repetition priority
// Each clue must have: attempts (array of {timestamp, correct})
export function scoreAndSortClues(clues, now) {
  const scored = clues.map((clue) => {
    const attempts = clue.attempts || [];
    const total = attempts.length;
    const correct = attempts.filter(a => a.correct).length;
    const wilsonLower = calculateWilsonLower(correct, total);
    const lastAttemptTime = total > 0 ? Math.max(...attempts.map(a => a.timestamp)) : 0;
    const priority = calculatePriority(wilsonLower, total, lastAttemptTime, now);

    return { ...clue, wilsonLower, total, correct, priority, lastAttemptTime };
  });

  scored.sort((a, b) => {
    const diff = a.priority - b.priority;
    if (Math.abs(diff) < 0.1) return Math.random() - 0.5;
    return diff;
  });

  return scored;
}
