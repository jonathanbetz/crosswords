import { kv } from '@vercel/kv';
import { apiHandler } from '../utils/api-handler.js';

export default apiHandler({ PATCH: updatePuzzle });

async function updatePuzzle(req, res) {
  const puzzleDate = req.query.date;
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
