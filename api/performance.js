import { kv } from '@vercel/kv';

// Calculate Wilson score lower bound for binomial proportion confidence interval
function calculateWilsonLower(successes, total) {
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
      return res.status(200).json({ clues: [] });
    }

    // Collect all completed clues from all puzzles
    const allClues = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (record && record.clues) {
        for (const clue of record.clues) {
          // Skip ignored clues
          if (clue.ignored) continue;

          // Only include clues with complete answers
          if (clue.answer && clue.pattern && clue.answer.length === clue.pattern.length) {
            allClues.push({
              ...clue,
              puzzleDate: date,
              savedAt: record.savedAt
            });
          }
        }
      }
    }

    // Get quiz attempt stats for all clues
    const cluesWithStats = await Promise.all(
      allClues.map(async (clue) => {
        const clueId = `${clue.direction}-${clue.number}`;
        const statsKey = `quiz:${clue.puzzleDate}:${clueId}`;
        const attempts = await kv.get(statsKey) || [];

        const total = attempts.length;
        const correct = attempts.filter(a => a.correct).length;
        const wilsonLower = calculateWilsonLower(correct, total);

        // Calculate time-based stats
        const now = Date.now();
        const hourAgo = now - 60 * 60 * 1000;
        const dayAgo = now - 24 * 60 * 60 * 1000;
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

        const lastHourAttempts = attempts.filter(a => a.timestamp > hourAgo);
        const lastDayAttempts = attempts.filter(a => a.timestamp > dayAgo);
        const lastWeekAttempts = attempts.filter(a => a.timestamp > weekAgo);

        const calcPercent = (arr) => {
          if (arr.length === 0) return null;
          return Math.round((arr.filter(a => a.correct).length / arr.length) * 100);
        };

        return {
          text: clue.text,
          answer: clue.answer,
          pattern: clue.pattern,
          number: clue.number,
          direction: clue.direction,
          puzzleDate: clue.puzzleDate,
          stats: {
            total,
            correct,
            percent: total > 0 ? Math.round((correct / total) * 100) : null,
            wilsonLower: Math.round(wilsonLower * 1000) / 1000,
            lastHour: {
              total: lastHourAttempts.length,
              correct: lastHourAttempts.filter(a => a.correct).length,
              percent: calcPercent(lastHourAttempts)
            },
            lastDay: {
              total: lastDayAttempts.length,
              correct: lastDayAttempts.filter(a => a.correct).length,
              percent: calcPercent(lastDayAttempts)
            },
            lastWeek: {
              total: lastWeekAttempts.length,
              correct: lastWeekAttempts.filter(a => a.correct).length,
              percent: calcPercent(lastWeekAttempts)
            }
          }
        };
      })
    );

    // Sort by Wilson score (lowest first - these need most practice)
    cluesWithStats.sort((a, b) => {
      // Clues with no attempts first
      if (a.stats.total === 0 && b.stats.total > 0) return -1;
      if (b.stats.total === 0 && a.stats.total > 0) return 1;
      // Then by Wilson score ascending
      return a.stats.wilsonLower - b.stats.wilsonLower;
    });

    return res.status(200).json({
      clues: cluesWithStats,
      total: cluesWithStats.length
    });
  } catch (error) {
    console.error('Error getting performance data:', error);
    return res.status(500).json({ error: 'Failed to get performance data' });
  }
}
