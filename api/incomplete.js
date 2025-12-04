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
      return res.status(200).json({ clues: [] });
    }

    // Collect all incomplete clues from all puzzles
    const incompleteClues = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (record && record.clues) {
        for (const clue of record.clues) {
          // Skip ignored clues
          if (clue.ignored) continue;

          // Include clues without answers or with incomplete answers
          const hasCompleteAnswer = clue.answer && clue.pattern && clue.answer.length === clue.pattern.length;
          if (!hasCompleteAnswer) {
            incompleteClues.push({
              ...clue,
              puzzleDate: date
            });
          }
        }
      }
    }

    // Sort by puzzle date (most recent first), then by direction and number
    incompleteClues.sort((a, b) => {
      if (a.puzzleDate !== b.puzzleDate) {
        return b.puzzleDate.localeCompare(a.puzzleDate);
      }
      if (a.direction !== b.direction) {
        return a.direction.localeCompare(b.direction);
      }
      return a.number - b.number;
    });

    return res.status(200).json({
      clues: incompleteClues,
      total: incompleteClues.length
    });
  } catch (error) {
    console.error('Error getting incomplete clues:', error);
    return res.status(500).json({ error: 'Failed to get incomplete clues' });
  }
}
