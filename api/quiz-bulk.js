import { kv } from '@vercel/kv';
import { hasCompleteAnswer } from '../lib/clue.js';
import { apiHandler } from '../lib/api-handler.js';

const RECENT_ATTEMPTS_KEY = 'quiz:recent-attempts';

export default apiHandler({ GET: getQuizBulk });

async function getQuizBulk(req, res) {
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

  // Batch fetch all puzzle records in one round-trip
  const puzzleKeys = dates.map(d => `puzzle:${d}`);
  const records = await kv.mget(...puzzleKeys);

  // Collect eligible clues and their KV keys for a second batch fetch
  const eligibleClues = []; // { clue, date, markedComplete, statsKey, hintsKey }

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const record = records[i];

    if (!record || !record.clues) continue;
    if (record.markedComplete && !showCompletedPuzzles) continue;

    for (const clue of record.clues) {
      if (clue.ignored || !hasCompleteAnswer(clue)) continue;

      const clueId = `${clue.direction}-${clue.number}`;
      eligibleClues.push({
        clue,
        date,
        markedComplete: record.markedComplete || false,
        statsKey: `quiz:${date}:${clueId}`,
        hintsKey: `hints:${date}:${clueId}`
      });
    }
  }

  if (eligibleClues.length === 0) {
    return res.status(200).json({
      clues: [],
      newAttempts: [],
      fetchedAt: Date.now(),
      isIncremental: false
    });
  }

  // Batch fetch all stats and hints keys in one round-trip
  const allKeys = eligibleClues.flatMap(e => [e.statsKey, e.hintsKey]);
  const allValues = await kv.mget(...allKeys);

  const clues = eligibleClues.map(({ clue, date, markedComplete }, i) => {
    const attempts = allValues[i * 2] || [];
    const rawHints = allValues[i * 2 + 1];
    const hintsAvailable = rawHints !== null ? rawHints : clue.answer.length * 2;

    return {
      text: clue.text,
      pattern: clue.pattern,
      answer: clue.answer,
      number: clue.number,
      direction: clue.direction,
      puzzleDate: date,
      attempts,
      hintsAvailable,
      puzzleComplete: markedComplete
    };
  });

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
      const entry = {
        timestamp: attempt.timestamp,
        correct: attempt.correct,
        grade: attempt.grade,
        hints: attempt.hints
      };
      const existing = acc.find(a => a.clueKey === attempt.clueKey);
      if (existing) {
        existing.attempts.push(entry);
      } else {
        acc.push({ clueKey: attempt.clueKey, attempts: [entry] });
      }
      return acc;
    }, []);

  // For incremental sync, skip puzzle iteration - it's slow and puzzles rarely change
  // New puzzles will be picked up on next full sync (when SYNC_INTERVAL expires)
  return res.status(200).json({
    clues: [],
    newAttempts,
    fetchedAt: Date.now(),
    isIncremental: true
  });
}
