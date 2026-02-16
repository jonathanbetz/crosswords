// Calculate Wilson score lower bound for binomial proportion confidence interval
// This gives a conservative estimate that accounts for sample size
// z = 1.96 for 95% confidence interval
export function calculateWilsonLower(successes, total) {
  if (total === 0) {
    return 0;
  }

  const z = 1.96; // 95% confidence
  const p = successes / total;
  const z2 = z * z;
  const n = total;

  const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;

  return numerator / denominator;
}
