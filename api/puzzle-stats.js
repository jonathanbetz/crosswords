import { kv } from '@vercel/kv';

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

        const total = record.clues.length;
        let complete = 0;
        let incomplete = 0;

        // Count complete/incomplete clues and gather quiz stats
        // Accuracy is computed as average of each clue's accuracy (0% for clues with no attempts)
        let clueAccuracySum = 0;
        let weeklyTotal = 0;
        let weeklyCorrect = 0;

        for (const clue of record.clues) {
          const pattern = clue.pattern || '';
          const answer = clue.answer || '';
          const hasCompleteAnswer = answer.length === pattern.length && answer.length > 0;

          if (hasCompleteAnswer) {
            complete++;
          } else {
            incomplete++;
          }

          // Get quiz attempts for this clue
          const clueId = `${clue.direction}-${clue.number}`;
          const quizKey = `quiz:${date}:${clueId}`;
          const attempts = await kv.get(quizKey) || [];

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

        // Average accuracy across all clues
        const averageAccuracy = total > 0 ? Math.round((clueAccuracySum / total) * 100) : null;

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
