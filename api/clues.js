import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    return saveClues(req, res);
  } else if (req.method === 'GET') {
    return getClues(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function saveClues(req, res) {
  try {
    const { puzzleDate, clues } = req.body;

    if (!puzzleDate || !clues || !Array.isArray(clues)) {
      return res.status(400).json({ error: 'Missing puzzleDate or clues array' });
    }

    // Store clues keyed by puzzle date
    const key = `puzzle:${puzzleDate}`;
    const record = {
      puzzleDate,
      clues,
      savedAt: new Date().toISOString()
    };

    await kv.set(key, record);

    // Also add to list of all puzzle dates for easy retrieval
    await kv.sadd('puzzle:dates', puzzleDate);

    return res.status(200).json({ success: true, puzzleDate });
  } catch (error) {
    console.error('Error saving clues:', error);
    return res.status(500).json({ error: 'Failed to save clues' });
  }
}

async function getClues(req, res) {
  try {
    const { date } = req.query;

    if (date) {
      // Get clues for specific puzzle date
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (!record) {
        return res.status(404).json({ error: 'Puzzle not found' });
      }

      return res.status(200).json(record);
    } else {
      // Get list of all saved puzzle dates with summary stats
      const dates = await kv.smembers('puzzle:dates');
      const sortedDates = dates.sort().reverse();

      // Fetch summary info for each puzzle
      const puzzles = await Promise.all(
        sortedDates.map(async (d) => {
          const record = await kv.get(`puzzle:${d}`);
          if (!record) return { date: d, total: 0, incomplete: 0 };

          const total = record.clues.length;
          const incomplete = record.clues.filter(c => {
            const pattern = c.pattern || '';
            const answer = c.answer || '';
            return answer.length !== pattern.length || answer.length === 0;
          }).length;

          return { date: d, total, incomplete };
        })
      );

      return res.status(200).json({ dates: sortedDates, puzzles });
    }
  } catch (error) {
    console.error('Error getting clues:', error);
    return res.status(500).json({ error: 'Failed to get clues' });
  }
}
