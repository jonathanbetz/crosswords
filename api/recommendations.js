import { kv } from '@vercel/kv';
import { calculateWilsonLower } from './utils/wilson-score.js';

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
      let answeredClueCount = 0;

      for (const clue of record.clues) {
        // Skip ignored clues
        if (clue.ignored) continue;

        // Must have a pattern to know the length
        if (!clue.pattern) continue;

        const answerLength = clue.pattern.length;
        totalSquares += answerLength;

        // If no complete answer, treat as 0% solvable (can't quiz on it)
        const hasCompleteAnswer = clue.answer && clue.answer.length === clue.pattern.length;

        let wilsonScore = 0;
        let total = 0;
        let correct = 0;

        if (hasCompleteAnswer) {
          answeredClueCount++;
          const clueId = `${clue.direction}-${clue.number}`;
          const statsKey = `quiz:${date}:${clueId}`;
          const attempts = await kv.get(statsKey) || [];

          total = attempts.length;
          correct = attempts.filter(a => a.correct).length;
          wilsonScore = calculateWilsonLower(correct, total);

          if (total > 0) quizzedClueCount++;
        }

        totalExpected += wilsonScore * answerLength;

        clues.push({
          number: clue.number,
          direction: clue.direction,
          text: clue.text,
          answer: hasCompleteAnswer ? clue.answer : null,
          pattern: clue.pattern ? clue.pattern.replace(/_/g, '?') : null,
          length: answerLength,
          wilsonScore: Math.round(wilsonScore * 100) / 100,
          attempts: total,
          hasAnswer: hasCompleteAnswer
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
        answeredClueCount,
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
