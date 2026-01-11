import { kv } from '@vercel/kv';

const GITHUB_BASE = 'https://raw.githubusercontent.com/doshea/nyt_crosswords/master';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // DELETE: remove a puzzle
  if (req.method === 'DELETE') {
    return handleDelete(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check for bulk import action (creates new puzzle records)
  const { action } = req.query;
  if (action === 'bulk') {
    return handleBulkImport(req, res);
  }

  // Default: import answers from GitHub for existing puzzles
  try {
    const { date } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Check if puzzle exists
    const puzzleKey = `puzzle:${date}`;
    const existing = await kv.get(puzzleKey);
    if (!existing || !existing.clues) {
      return res.status(404).json({ error: 'Puzzle not found. Add clues first.' });
    }

    // Parse date components for GitHub URL
    const [year, month, day] = date.split('-');
    const githubUrl = `${GITHUB_BASE}/${year}/${month}/${day}.json`;

    // Fetch puzzle from GitHub
    const response = await fetch(githubUrl);
    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Puzzle not found in archive', date });
      }
      throw new Error(`GitHub fetch failed: ${response.status}`);
    }

    const archiveData = await response.json();

    // Build answer lookup from archive
    const answerLookup = buildAnswerLookup(archiveData);

    // Update existing clues with answers
    let updatedCount = 0;
    let skippedCount = 0;

    const updatedClues = existing.clues.map(clue => {
      const key = `${clue.direction}-${clue.number}`;
      const archiveAnswer = answerLookup[key];

      if (archiveAnswer) {
        // Only update if answer is missing or incomplete (contains underscores)
        const currentAnswer = clue.answer || '';
        const hasCompleteAnswer = currentAnswer.length > 0
          && currentAnswer.length === archiveAnswer.length
          && !currentAnswer.includes('_');

        if (!hasCompleteAnswer) {
          updatedCount++;
          return {
            ...clue,
            answer: archiveAnswer.toUpperCase(),
            pattern: archiveAnswer.toUpperCase() // Also set pattern if missing
          };
        } else {
          skippedCount++;
          return clue;
        }
      }
      return clue;
    });

    // Save updated puzzle
    const updatedRecord = {
      ...existing,
      clues: updatedClues,
      updatedAt: new Date().toISOString(),
      answersImportedFrom: 'github-archive'
    };

    await kv.set(puzzleKey, updatedRecord);

    return res.status(200).json({
      success: true,
      puzzleDate: date,
      updatedCount,
      skippedCount,
      totalClues: existing.clues.length
    });

  } catch (error) {
    console.error('Error importing answers:', error);
    return res.status(500).json({ error: 'Failed to import answers', details: error.message });
  }
}

function buildAnswerLookup(archiveData) {
  const lookup = {};
  const { clues: rawClues, answers } = archiveData;

  // Process across answers
  if (rawClues.across && answers.across) {
    rawClues.across.forEach((clueText, idx) => {
      const match = clueText.match(/^(\d+)\./);
      if (match && answers.across[idx]) {
        const number = parseInt(match[1]);
        lookup[`across-${number}`] = answers.across[idx];
      }
    });
  }

  // Process down answers
  if (rawClues.down && answers.down) {
    rawClues.down.forEach((clueText, idx) => {
      const match = clueText.match(/^(\d+)\./);
      if (match && answers.down[idx]) {
        const number = parseInt(match[1]);
        lookup[`down-${number}`] = answers.down[idx];
      }
    });
  }

  return lookup;
}

// Bulk import: creates new puzzle records from crawler data
async function handleBulkImport(req, res) {
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

// Delete a puzzle by date
async function handleDelete(req, res) {
  try {
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const key = `puzzle:${date}`;
    const existing = await kv.get(key);

    if (!existing) {
      return res.status(404).json({ error: 'Puzzle not found', date });
    }

    // Delete the puzzle
    await kv.del(key);

    // Remove from the dates set
    await kv.srem('puzzle:dates', date);

    return res.status(200).json({
      success: true,
      deleted: date
    });
  } catch (error) {
    console.error('Error deleting puzzle:', error);
    return res.status(500).json({ error: 'Failed to delete puzzle' });
  }
}
