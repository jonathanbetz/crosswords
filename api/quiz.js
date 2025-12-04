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
      return res.status(404).json({ error: 'No puzzles found' });
    }

    // Collect all completed clues from all puzzles
    const completedClues = [];

    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (record && record.clues) {
        for (const clue of record.clues) {
          // Only include clues with complete answers (answer length matches pattern length)
          if (clue.answer && clue.pattern && clue.answer.length === clue.pattern.length) {
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

    // Pick a random clue
    const randomIndex = Math.floor(Math.random() * completedClues.length);
    const clue = completedClues[randomIndex];

    return res.status(200).json({
      clue: {
        text: clue.text,
        pattern: clue.pattern,
        answer: clue.answer,
        number: clue.number,
        direction: clue.direction,
        puzzleDate: clue.puzzleDate
      },
      totalCompleted: completedClues.length
    });
  } catch (error) {
    console.error('Error getting quiz clue:', error);
    return res.status(500).json({ error: 'Failed to get quiz clue' });
  }
}
