import { kv } from '@vercel/kv';
import { calculateWilsonLower } from '../lib/wilson-score.js';
import { hasCompleteAnswer } from '../lib/clue.js';
import { apiHandler } from '../lib/api-handler.js';

export default apiHandler({ GET: getRecommendations });

async function getRecommendations(req, res) {
  try {
    const dates = await kv.smembers('puzzle:dates');

    if (!dates || dates.length === 0) {
      return res.status(200).json({ recommendations: [] });
    }

    // Batch fetch all puzzle records in one round-trip
    const puzzleKeys = dates.map(d => `puzzle:${d}`);
    const records = await kv.mget(...puzzleKeys);

    // Collect eligible clues and their quiz keys for a second batch fetch
    const eligiblePuzzles = []; // { date, record, eligibleClues: [{clue, clueId, statsKey}] }

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const record = records[i];
      if (!record || !record.clues || record.markedComplete) continue;

      const eligibleClues = [];
      for (const clue of record.clues) {
        if (clue.ignored || !clue.pattern) continue;
        const clueId = `${clue.direction}-${clue.number}`;
        eligibleClues.push({
          clue,
          clueId,
          statsKey: `quiz:${date}:${clueId}`,
          complete: hasCompleteAnswer(clue)
        });
      }

      if (eligibleClues.length > 0) {
        eligiblePuzzles.push({ date, record, eligibleClues });
      }
    }

    if (eligiblePuzzles.length === 0) {
      return res.status(200).json({ recommendations: [] });
    }

    // Batch fetch all quiz stats in one round-trip
    const allStatsKeys = eligiblePuzzles.flatMap(p =>
      p.eligibleClues.filter(ec => ec.complete).map(ec => ec.statsKey)
    );
    const allStats = allStatsKeys.length > 0 ? await kv.mget(...allStatsKeys) : [];

    // Build a map from statsKey -> attempts[]
    const statsMap = {};
    allStatsKeys.forEach((key, i) => {
      statsMap[key] = allStats[i] || [];
    });

    // Assemble recommendations
    const recommendations = [];

    for (const { date, eligibleClues } of eligiblePuzzles) {
      const clues = [];
      let totalSquares = 0;
      let totalExpected = 0;
      let quizzedClueCount = 0;
      let answeredClueCount = 0;

      for (const { clue, statsKey, complete } of eligibleClues) {
        const answerLength = clue.pattern.length;
        totalSquares += answerLength;

        let wilsonScore = 0;
        let total = 0;

        if (complete) {
          answeredClueCount++;
          const attempts = statsMap[statsKey] || [];
          total = attempts.length;
          const correct = attempts.filter(a => a.correct).length;
          wilsonScore = calculateWilsonLower(correct, total);
          if (total > 0) quizzedClueCount++;
        }

        totalExpected += wilsonScore * answerLength;

        clues.push({
          number: clue.number,
          direction: clue.direction,
          text: clue.text,
          answer: complete ? clue.answer : null,
          pattern: clue.pattern ? clue.pattern.replace(/_/g, '?') : null,
          length: answerLength,
          wilsonScore: Math.round(wilsonScore * 100) / 100,
          attempts: total,
          hasAnswer: complete
        });
      }

      if (clues.length === 0 || totalSquares === 0) continue;

      recommendations.push({
        puzzleDate: date,
        solvabilityScore: Math.round((totalExpected / totalSquares) * 100) / 100,
        totalSquares,
        expectedSquares: Math.round(totalExpected * 10) / 10,
        clueCount: clues.length,
        answeredClueCount,
        quizzedClueCount,
        clues
      });
    }

    recommendations.sort((a, b) => b.solvabilityScore - a.solvabilityScore);

    return res.status(200).json({ recommendations });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
}
