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
    const { all, includeCompleted } = req.query;
    const showAll = all === 'true';
    const showCompletedPuzzles = includeCompleted === 'true';

    // Get all puzzle dates
    const dates = await kv.smembers('puzzle:dates');

    if (!dates || dates.length === 0) {
      return res.status(200).json({ clues: [] });
    }

    // Collect clues from all puzzles
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

          const hasCompleteAnswer = clue.answer && clue.pattern && clue.answer.length === clue.pattern.length;

          // Include all clues if showAll, otherwise only incomplete ones
          if (showAll || !hasCompleteAnswer) {
            clues.push({
              ...clue,
              puzzleDate: date,
              savedAt: record.savedAt || date // Fall back to puzzle date if savedAt not present
            });
          }
        }
      }
    }

    // Sort by date added (most recent first), then by direction and number
    clues.sort((a, b) => {
      if (a.savedAt !== b.savedAt) {
        return b.savedAt.localeCompare(a.savedAt);
      }
      if (a.direction !== b.direction) {
        return a.direction.localeCompare(b.direction);
      }
      return a.number - b.number;
    });

    return res.status(200).json({
      clues: clues,
      total: clues.length
    });
  } catch (error) {
    console.error('Error getting incomplete clues:', error);
    return res.status(500).json({ error: 'Failed to get incomplete clues' });
  }
}
