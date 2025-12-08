import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { date } = req.query;

  if (req.method === 'PATCH') {
    return updatePuzzle(req, res, date);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function updatePuzzle(req, res, puzzleDate) {
  try {
    const { markedComplete } = req.body;

    if (typeof markedComplete !== 'boolean') {
      return res.status(400).json({ error: 'markedComplete must be a boolean' });
    }

    const key = `puzzle:${puzzleDate}`;
    const record = await kv.get(key);

    if (!record) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    record.markedComplete = markedComplete;
    record.updatedAt = new Date().toISOString();

    await kv.set(key, record);

    return res.status(200).json({ success: true, markedComplete });
  } catch (error) {
    console.error('Error updating puzzle:', error);
    return res.status(500).json({ error: 'Failed to update puzzle' });
  }
}
