import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { puzzleDate, clues } = req.body;

    if (!puzzleDate || !clues || !Array.isArray(clues)) {
      return res.status(400).json({ error: 'Missing puzzleDate or clues array' });
    }

    // Validate puzzle date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) {
      return res.status(400).json({ error: 'Invalid puzzleDate format. Use YYYY-MM-DD' });
    }

    // Check if puzzle already exists
    const key = `puzzle:${puzzleDate}`;
    const existing = await kv.get(key);
    if (existing) {
      return res.status(409).json({ error: 'Puzzle already exists', puzzleDate });
    }

    // Validate clues - each must have required fields
    const validatedClues = [];
    for (const clue of clues) {
      if (!clue.text || !clue.number || !clue.direction) {
        continue; // Skip invalid clues
      }

      // Normalize direction to lowercase
      const direction = clue.direction.toLowerCase();
      if (direction !== 'across' && direction !== 'down') {
        continue;
      }

      // Build pattern from answer if not provided
      const answer = (clue.answer || '').toUpperCase();
      const pattern = clue.pattern || answer || '_'.repeat(answer.length);

      validatedClues.push({
        number: parseInt(clue.number, 10),
        direction,
        text: clue.text,
        answer,
        pattern,
        ignored: false
      });
    }

    if (validatedClues.length === 0) {
      return res.status(400).json({ error: 'No valid clues provided' });
    }

    // Create puzzle record
    const record = {
      puzzleDate,
      clues: validatedClues,
      savedAt: new Date().toISOString(),
      importedFrom: 'nyt-crawler'
    };

    await kv.set(key, record);

    // Add to list of all puzzle dates
    await kv.sadd('puzzle:dates', puzzleDate);

    return res.status(200).json({
      success: true,
      puzzleDate,
      clueCount: validatedClues.length
    });
  } catch (error) {
    console.error('Error bulk importing puzzle:', error);
    return res.status(500).json({ error: 'Failed to import puzzle' });
  }
}
