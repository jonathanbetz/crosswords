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
    const { includeCompleted, since } = req.query;
    const showCompletedPuzzles = includeCompleted === 'true';
    const sinceTimestamp = since ? parseInt(since, 10) : 0;
    const isIncremental = sinceTimestamp > 0;

    // Get all puzzle dates
    const dates = await kv.smembers('puzzle:dates');

    if (!dates || dates.length === 0) {
      return res.status(200).json({
        clues: [],
        newAttempts: [],
        fetchedAt: Date.now(),
        isIncremental
      });
    }

    const clues = [];
    const newAttempts = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (!record || !record.clues) continue;

      // Skip puzzles marked as complete unless includeCompleted is true
      if (record.markedComplete && !showCompletedPuzzles) continue;

      // For incremental sync, check if puzzle was updated since last sync
      const puzzleUpdatedAt = record.updatedAt ? new Date(record.updatedAt).getTime() : 0;
      const puzzleIsNew = !isIncremental || puzzleUpdatedAt > sinceTimestamp;

      for (const clue of record.clues) {
        // Skip ignored clues
        if (clue.ignored) continue;

        // Only include clues with complete answers
        if (!clue.answer || !clue.pattern || clue.answer.length !== clue.pattern.length) continue;

        const clueId = `${clue.direction}-${clue.number}`;
        const clueKey = `${date}:${clueId}`;
        const statsKey = `quiz:${date}:${clueId}`;

        if (isIncremental) {
          // Incremental: only fetch attempts and check for new ones
          const attempts = await kv.get(statsKey) || [];
          const recentAttempts = attempts.filter(a => a.timestamp > sinceTimestamp);

          if (recentAttempts.length > 0) {
            newAttempts.push({
              clueKey,
              attempts: recentAttempts
            });
          }

          // Only include clue data if puzzle was updated
          if (puzzleIsNew) {
            clues.push({
              text: clue.text,
              pattern: clue.pattern,
              answer: clue.answer,
              number: clue.number,
              direction: clue.direction,
              puzzleDate: date,
              attempts: attempts
            });
          }
        } else {
          // Full sync: include everything
          const attempts = await kv.get(statsKey) || [];
          clues.push({
            text: clue.text,
            pattern: clue.pattern,
            answer: clue.answer,
            number: clue.number,
            direction: clue.direction,
            puzzleDate: date,
            attempts: attempts
          });
        }
      }
    }

    return res.status(200).json({
      clues,
      newAttempts: isIncremental ? newAttempts : [],
      fetchedAt: Date.now(),
      isIncremental
    });
  } catch (error) {
    console.error('Error getting bulk quiz data:', error);
    return res.status(500).json({ error: 'Failed to get quiz data' });
  }
}
