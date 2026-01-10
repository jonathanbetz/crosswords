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

    // Check if puzzle already exists
    const existingKey = `puzzle:${date}`;
    const existing = await kv.get(existingKey);
    if (existing) {
      return res.status(409).json({ error: 'Puzzle already exists', puzzleDate: date });
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

    const puzzleData = await response.json();

    // Transform to our format
    const clues = transformPuzzle(puzzleData);

    // Save to database
    const record = {
      puzzleDate: date,
      clues,
      savedAt: new Date().toISOString(),
      importedFrom: 'github-archive'
    };

    await kv.set(existingKey, record);
    await kv.sadd('puzzle:dates', date);

    return res.status(200).json({
      success: true,
      puzzleDate: date,
      clueCount: clues.length,
      acrossCount: clues.filter(c => c.direction === 'across').length,
      downCount: clues.filter(c => c.direction === 'down').length
    });

  } catch (error) {
    console.error('Error importing puzzle:', error);
    return res.status(500).json({ error: 'Failed to import puzzle', details: error.message });
  }
}

function transformPuzzle(data) {
  const { grid, gridnums, clues: rawClues, answers, size } = data;
  const cols = size.cols;
  const rows = size.rows;

  // Build a map of cell number -> grid position
  const numToPos = {};
  for (let i = 0; i < gridnums.length; i++) {
    if (gridnums[i] > 0) {
      numToPos[gridnums[i]] = {
        row: Math.floor(i / cols),
        col: i % cols
      };
    }
  }

  const transformedClues = [];

  // Process across clues
  if (rawClues.across && answers.across) {
    rawClues.across.forEach((clueText, idx) => {
      const answer = answers.across[idx];
      // Extract clue number from the text (e.g., "1. Some clue text")
      const match = clueText.match(/^(\d+)\.\s*(.*)$/);
      if (match) {
        const number = parseInt(match[1]);
        const text = match[2];

        transformedClues.push({
          number,
          direction: 'across',
          text,
          pattern: '_'.repeat(answer.length),
          answer: answer.toUpperCase()
        });
      }
    });
  }

  // Process down clues
  if (rawClues.down && answers.down) {
    rawClues.down.forEach((clueText, idx) => {
      const answer = answers.down[idx];
      const match = clueText.match(/^(\d+)\.\s*(.*)$/);
      if (match) {
        const number = parseInt(match[1]);
        const text = match[2];

        transformedClues.push({
          number,
          direction: 'down',
          text,
          pattern: '_'.repeat(answer.length),
          answer: answer.toUpperCase()
        });
      }
    });
  }

  // Sort by number, then direction
  transformedClues.sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    return a.direction === 'across' ? -1 : 1;
  });

  return transformedClues;
}
