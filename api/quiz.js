import { kv } from '@vercel/kv';

// Calculate Wilson score lower bound for binomial proportion confidence interval
// This gives a conservative estimate that accounts for sample size
// z = 1.96 for 95% confidence interval
function calculateWilsonLower(successes, total) {
  if (total === 0) {
    // No attempts yet - return 0 to prioritize untested clues
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

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all puzzle dates
    const dates = await kv.smembers('puzzle:dates');

    if (!dates || dates.length === 0) {
      return res.status(404).json({ error: 'No puzzles found' });
    }

    // Collect all completed clues from all puzzles
    const completedClues = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (record && record.clues) {
        for (const clue of record.clues) {
          // Skip ignored clues
          if (clue.ignored) continue;

          // Only include clues with complete answers (answer length matches pattern length)
          if (clue.answer && clue.pattern && clue.answer.length === clue.pattern.length) {
            completedClues.push({
              ...clue,
              puzzleDate: date
            });
          }
        }
      }
    }

    if (completedClues.length === 0) {
      return res.status(404).json({ error: 'No completed clues found' });
    }

    // Get quiz attempt stats for all clues and calculate Wilson scores
    const cluesWithScores = await Promise.all(
      completedClues.map(async (clue) => {
        const clueId = `${clue.direction}-${clue.number}`;
        const statsKey = `quiz:${clue.puzzleDate}:${clueId}`;
        const attempts = await kv.get(statsKey) || [];

        const total = attempts.length;
        const correct = attempts.filter(a => a.correct).length;

        // Calculate Wilson score lower bound
        // This gives a conservative estimate of the true success rate
        const wilsonLower = calculateWilsonLower(correct, total);

        return {
          ...clue,
          wilsonLower,
          total,
          correct
        };
      })
    );

    // Sort by Wilson lower bound (ascending) - clues we're least confident about go first
    // Add some randomization among clues with similar scores
    cluesWithScores.sort((a, b) => {
      const diff = a.wilsonLower - b.wilsonLower;
      // If scores are very close (within 0.05), randomize
      if (Math.abs(diff) < 0.05) {
        return Math.random() - 0.5;
      }
      return diff;
    });

    // Pick from the top candidates (lowest Wilson scores)
    // Use weighted selection favoring the worst-performing clues
    const topCount = Math.min(5, cluesWithScores.length);
    const weights = [];
    for (let i = 0; i < topCount; i++) {
      // Higher weight for lower-ranked (worse performing) clues
      weights.push(topCount - i);
    }
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let selectedIndex = 0;
    for (let i = 0; i < topCount; i++) {
      rand -= weights[i];
      if (rand <= 0) {
        selectedIndex = i;
        break;
      }
    }

    const clue = cluesWithScores[selectedIndex];

    return res.status(200).json({
      clue: {
        text: clue.text,
        pattern: clue.pattern,
        answer: clue.answer,
        number: clue.number,
        direction: clue.direction,
        puzzleDate: clue.puzzleDate
      },
      totalCompleted: completedClues.length,
      wilsonLower: clue.wilsonLower,
      attempts: clue.total,
      correct: clue.correct
    });
  } catch (error) {
    console.error('Error getting quiz clue:', error);
    return res.status(500).json({ error: 'Failed to get quiz clue' });
  }
}
