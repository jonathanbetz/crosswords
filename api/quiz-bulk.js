import { kv } from '@vercel/kv';

const RECENT_ATTEMPTS_KEY = 'quiz:recent-attempts';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { includeCompleted, since } = req.query;
    const showCompletedPuzzles = includeCompleted === 'true';
    const sinceTimestamp = since ? parseInt(since, 10) : 0;
    const isIncremental = sinceTimestamp > 0;

    // For incremental sync, use the efficient recent-attempts log
    if (isIncremental) {
      return handleIncrementalSync(req, res, sinceTimestamp, showCompletedPuzzles);
    }

    // Full sync: fetch all puzzles and clues
    return handleFullSync(req, res, showCompletedPuzzles);
  } catch (error) {
    console.error('Error getting bulk quiz data:', error);
    return res.status(500).json({ error: 'Failed to get quiz data' });
  }
}

async function handleFullSync(req, res, showCompletedPuzzles) {
  // Get all puzzle dates
  const dates = await kv.smembers('puzzle:dates');

  if (!dates || dates.length === 0) {
    return res.status(200).json({
      clues: [],
      newAttempts: [],
      fetchedAt: Date.now(),
      isIncremental: false
    });
  }

  const clues = [];

  for (const date of dates) {
    const key = `puzzle:${date}`;
    const record = await kv.get(key);

    if (!record || !record.clues) continue;

    // Skip puzzles marked as complete unless includeCompleted is true
    if (record.markedComplete && !showCompletedPuzzles) continue;

    for (const clue of record.clues) {
      // Skip ignored clues
      if (clue.ignored) continue;

      // Only include clues with complete answers
      if (!clue.answer || !clue.pattern || clue.answer.length !== clue.pattern.length) continue;

      const clueId = `${clue.direction}-${clue.number}`;
      const statsKey = `quiz:${date}:${clueId}`;
      const hintsKey = `hints:${date}:${clueId}`;
      const attempts = await kv.get(statsKey) || [];
      let hintsAvailable = await kv.get(hintsKey);

      // Default to 2x answer length if not set
      if (hintsAvailable === null) {
        hintsAvailable = clue.answer.length * 2;
      }

      clues.push({
        text: clue.text,
        pattern: clue.pattern,
        answer: clue.answer,
        number: clue.number,
        direction: clue.direction,
        puzzleDate: date,
        attempts: attempts,
        hintsAvailable: hintsAvailable,
        puzzleComplete: record.markedComplete || false
      });
    }
  }

  return res.status(200).json({
    clues,
    newAttempts: [],
    fetchedAt: Date.now(),
    isIncremental: false
  });
}

async function handleIncrementalSync(req, res, sinceTimestamp, showCompletedPuzzles) {
  // Get recent attempts from the log (single KV read!)
  const recentAttempts = await kv.get(RECENT_ATTEMPTS_KEY) || [];

  // Filter to only attempts since the given timestamp
  const newAttempts = recentAttempts
    .filter(a => a.timestamp > sinceTimestamp)
    .reduce((acc, attempt) => {
      // Group by clueKey
      const existing = acc.find(a => a.clueKey === attempt.clueKey);
      if (existing) {
        existing.attempts.push({ timestamp: attempt.timestamp, correct: attempt.correct });
      } else {
        acc.push({
          clueKey: attempt.clueKey,
          attempts: [{ timestamp: attempt.timestamp, correct: attempt.correct }]
        });
      }
      return acc;
    }, []);

  // Check for new/updated puzzles
  const dates = await kv.smembers('puzzle:dates');
  const clues = [];

  if (dates && dates.length > 0) {
    for (const date of dates) {
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (!record || !record.clues) continue;

      // Skip puzzles marked as complete unless includeCompleted is true
      if (record.markedComplete && !showCompletedPuzzles) continue;

      // Check if puzzle was updated since last sync
      const puzzleUpdatedAt = record.updatedAt ? new Date(record.updatedAt).getTime() : 0;
      if (puzzleUpdatedAt <= sinceTimestamp) continue;

      // Puzzle was updated - include its clues
      for (const clue of record.clues) {
        if (clue.ignored) continue;
        if (!clue.answer || !clue.pattern || clue.answer.length !== clue.pattern.length) continue;

        const clueId = `${clue.direction}-${clue.number}`;
        const statsKey = `quiz:${date}:${clueId}`;
        const attempts = await kv.get(statsKey) || [];

        clues.push({
          text: clue.text,
          pattern: clue.pattern,
          answer: clue.answer,
          number: clue.number,
          direction: clue.direction,
          puzzleDate: date,
          attempts: attempts,
          puzzleComplete: record.markedComplete || false
        });
      }
    }
  }

  return res.status(200).json({
    clues,
    newAttempts,
    fetchedAt: Date.now(),
    isIncremental: true
  });
}
