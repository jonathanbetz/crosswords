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
    const { includeCompleted } = req.query;
    const showCompletedPuzzles = includeCompleted === 'true';

    // Get all puzzle dates
    const dates = await kv.smembers('puzzle:dates');

    if (!dates || dates.length === 0) {
      return res.status(404).json({ error: 'No puzzles found' });
    }

    // Collect all completed clues from all puzzles with their attempts
    const clues = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (record && record.clues) {
        // Skip puzzles marked as complete unless includeCompleted is true
        if (record.markedComplete && !showCompletedPuzzles) continue;

        for (const clue of record.clues) {
          // Skip ignored clues
          if (clue.ignored) continue;

          // Only include clues with complete answers (answer length matches pattern length)
          if (clue.answer && clue.pattern && clue.answer.length === clue.pattern.length) {
            const clueId = `${clue.direction}-${clue.number}`;
            const statsKey = `quiz:${date}:${clueId}`;
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
    }

    return res.status(200).json({
      clues,
      fetchedAt: Date.now()
    });
  } catch (error) {
    console.error('Error getting bulk quiz data:', error);
    return res.status(500).json({ error: 'Failed to get quiz data' });
  }
}
