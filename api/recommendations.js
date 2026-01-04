import { kv } from '@vercel/kv';

// Calculate Wilson score lower bound (same as quiz.js)
function calculateWilsonLower(successes, total) {
  if (total === 0) return 0;

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
      return res.status(200).json({ recommendations: [] });
    }

    const recommendations = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (!record || !record.clues) continue;

      // Skip completed puzzles
      if (record.markedComplete) continue;

      const clues = [];
      let totalSquares = 0;
      let totalExpected = 0;
      let quizzedClueCount = 0;

      for (const clue of record.clues) {
        // Skip ignored clues
        if (clue.ignored) continue;

        // Only include clues with complete answers
        if (!clue.answer || !clue.pattern || clue.answer.length !== clue.pattern.length) continue;

        const clueId = `${clue.direction}-${clue.number}`;
        const statsKey = `quiz:${date}:${clueId}`;
        const attempts = await kv.get(statsKey) || [];

        const total = attempts.length;
        const correct = attempts.filter(a => a.correct).length;
        const wilsonScore = calculateWilsonLower(correct, total);
        const answerLength = clue.answer.length;

        if (total > 0) quizzedClueCount++;

        totalSquares += answerLength;
        totalExpected += wilsonScore * answerLength;

        clues.push({
          number: clue.number,
          direction: clue.direction,
          text: clue.text,
          length: answerLength,
          wilsonScore: Math.round(wilsonScore * 100) / 100,
          attempts: total
        });
      }

      // Skip puzzles with no quizzable clues
      if (clues.length === 0 || totalSquares === 0) continue;

      const solvabilityScore = totalExpected / totalSquares;

      recommendations.push({
        puzzleDate: date,
        solvabilityScore: Math.round(solvabilityScore * 100) / 100,
        totalSquares,
        expectedSquares: Math.round(totalExpected * 10) / 10,
        clueCount: clues.length,
        quizzedClueCount,
        clues
      });
    }

    // Sort by solvability score descending (most solvable first)
    recommendations.sort((a, b) => b.solvabilityScore - a.solvabilityScore);

    return res.status(200).json({ recommendations });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
}
