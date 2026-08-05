// Weighted-random candidate sampling used by the quiz selectors. Scheduling
// itself (priority, intervals) now lives in lib/scheduler.js (FSRS-lite); this
// module only holds the "pick from the top N by priority" sampler.

export const TOP_CANDIDATES_COUNT = 5;

// Weighted random selection from the top N candidates by priority.
// Returns the selected index into cluesWithScores.
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
