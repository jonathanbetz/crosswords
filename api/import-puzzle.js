import { kv } from '@vercel/kv';

const GITHUB_BASE = 'https://raw.githubusercontent.com/doshea/nyt_crosswords/master';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
        // Only update if answer was empty or incomplete
        const currentAnswer = clue.answer || '';
        const pattern = clue.pattern || '';
        const isIncomplete = currentAnswer.length !== pattern.length;

        if (isIncomplete) {
          updatedCount++;
          return {
            ...clue,
            answer: archiveAnswer.toUpperCase()
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
