import { kv } from '@vercel/kv';
import { hasCompleteAnswer } from './utils/clue.js';
import { apiHandler } from './utils/api-handler.js';

export default apiHandler({ GET: getPuzzleStats });

async function getPuzzleStats(req, res) {
  try {
    // Get all puzzle dates
    const dates = await kv.smembers('puzzle:dates');

    if (!dates || dates.length === 0) {
      return res.status(200).json({ puzzles: [] });
    }

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Collect stats for each puzzle
    const puzzles = await Promise.all(
      dates.map(async (date) => {
        const key = `puzzle:${date}`;
        const record = await kv.get(key);

        if (!record || !record.clues) {
          return {
            date,
            total: 0,
            complete: 0,
            incomplete: 0,
            markedComplete: false,
            weeklyQuizStats: { total: 0, correct: 0, percent: null }
          };
        }

        // Filter out ignored clues
        const activeClues = record.clues.filter(c => !c.ignored);
        const total = activeClues.length;
        let complete = 0;
        let incomplete = 0;

        // Separate complete from incomplete clues, collecting quiz keys for batch fetch
        const completeClues = [];
        const quizKeys = [];
        for (const clue of activeClues) {
          if (hasCompleteAnswer(clue)) {
            complete++;
            const clueId = `${clue.direction}-${clue.number}`;
            quizKeys.push(`quiz:${date}:${clueId}`);
            completeClues.push(clue);
          } else {
            incomplete++;
          }
        }

        // Batch fetch all attempt records for this puzzle in one round-trip
        const allAttempts = quizKeys.length > 0 ? await kv.mget(...quizKeys) : [];

        // Count complete/incomplete clues and gather quiz stats
        // Accuracy is computed as average of each completed clue's accuracy (0% for clues with no attempts)
        // Only clues with complete answers can be quizzed, so only those count toward accuracy
        let clueAccuracySum = 0;
        let weeklyTotal = 0;
        let weeklyCorrect = 0;

        for (let i = 0; i < completeClues.length; i++) {
          const attempts = allAttempts[i] || [];

          // Filter to last week only
          const weeklyAttempts = attempts.filter(a => a.timestamp >= weekAgo);
          const clueWeeklyTotal = weeklyAttempts.length;
          const clueWeeklyCorrect = weeklyAttempts.filter(a => a.correct).length;

          weeklyTotal += clueWeeklyTotal;
          weeklyCorrect += clueWeeklyCorrect;

          // Clue accuracy: 0% if no attempts, otherwise correct/total
          const clueAccuracy = clueWeeklyTotal > 0 ? clueWeeklyCorrect / clueWeeklyTotal : 0;
          clueAccuracySum += clueAccuracy;
        }

        // Average accuracy across completed clues only
        const averageAccuracy = complete > 0 ? Math.round((clueAccuracySum / complete) * 100) : null;

        return {
          date,
          total,
          complete,
          incomplete,
          markedComplete: record.markedComplete || false,
          weeklyQuizStats: {
            total: weeklyTotal,
            correct: weeklyCorrect,
            percent: averageAccuracy
          }
        };
      })
    );

    // Sort by date (newest first) by default
    puzzles.sort((a, b) => b.date.localeCompare(a.date));

    return res.status(200).json({ puzzles });
  } catch (error) {
    console.error('Error getting puzzle stats:', error);
    return res.status(500).json({ error: 'Failed to get puzzle stats' });
  }
}
