import { kv } from '@vercel/kv';
import { apiHandler } from '../lib/api-handler.js';

const GITHUB_BASE = 'https://raw.githubusercontent.com/doshea/nyt_crosswords/master';

export default apiHandler({ POST: handlePost, DELETE: handleDelete });

async function handlePost(req, res) {
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
        // Only update if answer (correct answer) is missing or incomplete
        const currentAnswer = clue.answer || '';
        const hasCompleteAnswer = currentAnswer.length > 0
          && currentAnswer.length === archiveAnswer.length
          && !currentAnswer.includes('_');

        if (!hasCompleteAnswer) {
          updatedCount++;
          return {
            ...clue,
            answer: archiveAnswer.toUpperCase()
            // Note: pattern stays as-is (current puzzle state with underscores)
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

// Expand pattern for rebus clues where answer is longer than pattern
// Preserves known letters at their positions from the end
export function expandPatternForRebus(pattern, answer) {
  if (!answer || !pattern || answer.length <= pattern.length) {
    return pattern;
  }

  // Find known letters and their positions from the END of the pattern
  const knownFromEnd = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '_') {
      knownFromEnd.push({
        char: pattern[i],
        distFromEnd: pattern.length - 1 - i
      });
    }
  }

  // Build new pattern of answer length
  const result = new Array(answer.length).fill('_');

  // Place known letters at the same distance from the end
  for (const { char, distFromEnd } of knownFromEnd) {
    const newIdx = answer.length - 1 - distFromEnd;
    if (newIdx >= 0) {
      result[newIdx] = char;
    }
  }

  return result.join('');
}

export function buildAnswerLookup(archiveData) {
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
// Automatically fetches correct answers from GitHub archive
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

    // Fetch correct answers from GitHub archive
    const [year, month, day] = puzzleDate.split('-');
    const githubUrl = `${GITHUB_BASE}/${year}/${month}/${day}.json`;
    let answerLookup = {};

    try {
      const response = await fetch(githubUrl);
      if (response.ok) {
        const archiveData = await response.json();
        answerLookup = buildAnswerLookup(archiveData);
      }
    } catch (e) {
      // Continue without answers if GitHub fetch fails
      console.log('GitHub fetch failed for', puzzleDate, e.message);
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

      // pattern = current state from puzzle (with underscores for unfilled)
      let pattern = clue.pattern || '';

      // Get correct answer from GitHub archive
      const clueKey = `${direction}-${clue.number}`;
      const archiveAnswer = answerLookup[clueKey];
      const answer = archiveAnswer ? archiveAnswer.toUpperCase() : null;

      // Expand pattern for rebus clues where answer is longer than pattern
      if (answer && pattern && answer.length > pattern.length) {
        pattern = expandPatternForRebus(pattern, answer);
      }

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
      importedFrom: 'nyt-crawler',
      answersImportedFrom: Object.keys(answerLookup).length > 0 ? 'github-archive' : null
    };

    await kv.set(key, record);

    // Add to list of all puzzle dates
    await kv.sadd('puzzle:dates', puzzleDate);

    return res.status(200).json({
      success: true,
      puzzleDate,
      clueCount: validatedClues.length,
      answersImported: Object.keys(answerLookup).length > 0
    });
  } catch (error) {
    console.error('Error bulk importing puzzle:', error);
    return res.status(500).json({ error: 'Failed to import puzzle' });
  }
}

// Delete a puzzle by date, or all puzzles if date=all
async function handleDelete(req, res) {
  try {
    const { date } = req.query;

    // Delete all puzzles
    if (date === 'all') {
      const dates = await kv.smembers('puzzle:dates') || [];
      let deleted = 0;

      for (const d of dates) {
        await kv.del(`puzzle:${d}`);
        deleted++;
      }

      // Clear the dates set
      if (dates.length > 0) {
        await kv.del('puzzle:dates');
      }

      return res.status(200).json({
        success: true,
        deleted: deleted,
        message: 'All puzzles deleted'
      });
    }

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
    return res.status(500).json({ error: 'Failed to delete puzzle', details: error.message });
  }
}
