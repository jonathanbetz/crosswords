import { kv } from '@vercel/kv';
import { hasCompleteAnswer } from '../lib/clue.js';
import { apiHandler } from '../lib/api-handler.js';
import {
  TOP_CANDIDATES_COUNT,
  calculateMinInterval,
  calculatePriority,
  selectWeightedFromTop
} from '../lib/spaced-repetition.js';
import { calculateWilsonLower } from '../lib/wilson-score.js';

export default apiHandler({ GET: getQuiz });

async function getQuiz(req, res) {
  try {
    const { includeCompleted } = req.query;
    const showCompletedPuzzles = includeCompleted === 'true';

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
        // Skip puzzles marked as complete unless includeCompleted is true
        if (record.markedComplete && !showCompletedPuzzles) continue;

        for (const clue of record.clues) {
          // Skip ignored clues
          if (clue.ignored) continue;

          // Only include clues with complete answers
          if (hasCompleteAnswer(clue)) {
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

    const selectedIndex = selectWeightedFromTop(cluesWithScores);
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
