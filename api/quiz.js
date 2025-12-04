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

// Calculate minimum interval before showing a clue again based on Wilson score
// Higher Wilson score = longer interval (more confident it's learned)
// Returns interval in milliseconds
function calculateMinInterval(wilsonLower, total) {
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
  // This creates longer gaps for well-learned items
  const scaleFactor = Math.pow(wilsonLower, 2) * maxMinutes + baseMinutes;

  // Also factor in total attempts - more attempts with high success = longer interval
  const attemptBonus = Math.min(total / 10, 1); // caps at 10 attempts
  const adjustedMinutes = scaleFactor * (1 + attemptBonus * wilsonLower);

  return adjustedMinutes * 60 * 1000; // Convert to milliseconds
}

// Calculate priority score for spaced repetition
// Lower score = higher priority (should be shown sooner)
function calculatePriority(wilsonLower, total, lastAttemptTime, now) {
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

    const now = Date.now();

    // Get quiz attempt stats for all clues and calculate spaced repetition priority
    const cluesWithScores = await Promise.all(
      completedClues.map(async (clue) => {
        const clueId = `${clue.direction}-${clue.number}`;
        const statsKey = `quiz:${clue.puzzleDate}:${clueId}`;
        const attempts = await kv.get(statsKey) || [];

        const total = attempts.length;
        const correct = attempts.filter(a => a.correct).length;

        // Calculate Wilson score lower bound
        const wilsonLower = calculateWilsonLower(correct, total);

        // Get last attempt time
        const lastAttemptTime = total > 0
          ? Math.max(...attempts.map(a => a.timestamp))
          : 0;

        // Calculate spaced repetition priority
        const priority = calculatePriority(wilsonLower, total, lastAttemptTime, now);

        // Calculate minimum interval for display
        const minInterval = calculateMinInterval(wilsonLower, total);
        const timeSinceLastAttempt = total > 0 ? now - lastAttemptTime : null;

        return {
          ...clue,
          wilsonLower,
          total,
          correct,
          priority,
          lastAttemptTime,
          minInterval,
          timeSinceLastAttempt
        };
      })
    );

    // Sort by priority (ascending) - lower priority score = should be shown first
    cluesWithScores.sort((a, b) => {
      const diff = a.priority - b.priority;
      // If priorities are very close, add some randomization
      if (Math.abs(diff) < 0.1) {
        return Math.random() - 0.5;
      }
      return diff;
    });

    // Pick from the top candidates (highest priority)
    // Use weighted selection favoring the highest priority clues
    const topCount = Math.min(5, cluesWithScores.length);
    const weights = [];
    for (let i = 0; i < topCount; i++) {
      // Higher weight for higher priority (lower index)
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
      correct: clue.correct,
      spacedRepetition: {
        priority: clue.priority,
        minIntervalMs: clue.minInterval,
        minIntervalMinutes: Math.round(clue.minInterval / 60000),
        timeSinceLastMs: clue.timeSinceLastAttempt,
        timeSinceLastMinutes: clue.timeSinceLastAttempt ? Math.round(clue.timeSinceLastAttempt / 60000) : null
      }
    });
  } catch (error) {
    console.error('Error getting quiz clue:', error);
    return res.status(500).json({ error: 'Failed to get quiz clue' });
  }
}
