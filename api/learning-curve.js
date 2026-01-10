import { kv } from '@vercel/kv';

// Calculate Wilson score lower bound
function calculateWilsonLower(successes, total) {
  if (total === 0) return 0;

  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const n = total;

  const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;

  return numerator / denominator;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { clueKey } = req.query;

    // If specific clue requested, return its history
    if (clueKey) {
      const attempts = await kv.get(`quiz:${clueKey}`) || [];
      return res.status(200).json({
        clueKey,
        attempts: attempts.map(a => ({
          timestamp: a.timestamp,
          correct: a.correct
        })),
        history: computeWilsonHistory(attempts)
      });
    }

    // Otherwise, return aggregate learning curve data
    const dates = await kv.smembers('puzzle:dates');
    if (!dates || dates.length === 0) {
      return res.status(200).json({ curves: [], dailyStats: [] });
    }

    // Collect all attempts with clue info
    const allAttempts = [];

    for (const date of dates) {
      const record = await kv.get(`puzzle:${date}`);
      if (!record || !record.clues) continue;

      for (const clue of record.clues) {
        if (clue.ignored) continue;
        if (!clue.answer || clue.answer.length !== clue.pattern?.length) continue;

        const clueId = `${clue.direction}-${clue.number}`;
        const statsKey = `quiz:${date}:${clueId}`;
        const attempts = await kv.get(statsKey) || [];

        for (const attempt of attempts) {
          allAttempts.push({
            timestamp: attempt.timestamp,
            correct: attempt.correct,
            clueKey: `${date}:${clueId}`,
            clueText: clue.text,
            answer: clue.answer
          });
        }
      }
    }

    // Sort by timestamp
    allAttempts.sort((a, b) => a.timestamp - b.timestamp);

    // Compute daily stats
    const dailyStats = computeDailyStats(allAttempts);

    // Compute rolling Wilson score over time
    const rollingWilson = computeRollingWilson(allAttempts);

    return res.status(200).json({
      dailyStats,
      rollingWilson,
      totalAttempts: allAttempts.length
    });
  } catch (error) {
    console.error('Error getting learning curve:', error);
    return res.status(500).json({ error: 'Failed to get learning curve data' });
  }
}

function computeWilsonHistory(attempts) {
  if (attempts.length === 0) return [];

  // Sort by timestamp
  const sorted = [...attempts].sort((a, b) => a.timestamp - b.timestamp);

  const history = [];
  let correct = 0;
  let total = 0;

  for (const attempt of sorted) {
    total++;
    if (attempt.correct) correct++;

    history.push({
      timestamp: attempt.timestamp,
      wilson: calculateWilsonLower(correct, total),
      correct,
      total
    });
  }

  return history;
}

function computeDailyStats(allAttempts) {
  const byDay = {};

  for (const attempt of allAttempts) {
    const day = new Date(attempt.timestamp).toISOString().split('T')[0];
    if (!byDay[day]) {
      byDay[day] = { total: 0, correct: 0 };
    }
    byDay[day].total++;
    if (attempt.correct) byDay[day].correct++;
  }

  return Object.entries(byDay)
    .map(([date, stats]) => ({
      date,
      total: stats.total,
      correct: stats.correct,
      percent: Math.round((stats.correct / stats.total) * 100)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeRollingWilson(allAttempts) {
  if (allAttempts.length === 0) return [];

  const points = [];
  let correct = 0;
  let total = 0;

  // Sample every 10 attempts to avoid too many data points
  for (let i = 0; i < allAttempts.length; i++) {
    total++;
    if (allAttempts[i].correct) correct++;

    if (i % 10 === 0 || i === allAttempts.length - 1) {
      points.push({
        timestamp: allAttempts[i].timestamp,
        wilson: calculateWilsonLower(correct, total),
        total,
        correct
      });
    }
  }

  return points;
}
