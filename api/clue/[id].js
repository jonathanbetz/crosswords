import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;

  if (req.method === 'PATCH') {
    return updateClue(req, res, id);
  } else if (req.method === 'DELETE') {
    return deleteClue(req, res, id);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function updateClue(req, res, clueId) {
  try {
    const { puzzleDate, updates } = req.body;

    if (!puzzleDate || !updates) {
      return res.status(400).json({ error: 'Missing puzzleDate or updates' });
    }

    const key = `puzzle:${puzzleDate}`;
    const record = await kv.get(key);

    if (!record) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Find and update the specific clue
    const clueIndex = record.clues.findIndex(
      c => `${c.direction}-${c.number}` === clueId
    );

    if (clueIndex === -1) {
      return res.status(404).json({ error: 'Clue not found' });
    }

    const clue = record.clues[clueIndex];

    // Validate answer length matches pattern length
    if (updates.answer && clue.pattern) {
      const expectedLength = clue.pattern.length;
      if (updates.answer.length !== expectedLength) {
        return res.status(400).json({
          error: `Answer must be ${expectedLength} characters`
        });
      }
    }

    record.clues[clueIndex] = { ...clue, ...updates };
    record.updatedAt = new Date().toISOString();

    await kv.set(key, record);

    return res.status(200).json({ success: true, clue: record.clues[clueIndex] });
  } catch (error) {
    console.error('Error updating clue:', error);
    return res.status(500).json({ error: 'Failed to update clue' });
  }
}

async function deleteClue(req, res, clueId) {
  try {
    const { puzzleDate } = req.query;

    if (!puzzleDate) {
      return res.status(400).json({ error: 'Missing puzzleDate' });
    }

    const key = `puzzle:${puzzleDate}`;
    const record = await kv.get(key);

    if (!record) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Remove the specific clue
    record.clues = record.clues.filter(
      c => `${c.direction}-${c.number}` !== clueId
    );
    record.updatedAt = new Date().toISOString();

    await kv.set(key, record);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting clue:', error);
    return res.status(500).json({ error: 'Failed to delete clue' });
  }
}
