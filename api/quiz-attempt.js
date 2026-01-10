import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    return recordAttempt(req, res);
  } else if (req.method === 'GET') {
    return getStats(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

const RECENT_ATTEMPTS_KEY = 'quiz:recent-attempts';
const RECENT_ATTEMPTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function recordAttempt(req, res) {
  try {
    const { clueId, puzzleDate, correct, answerLength, hintsUsed, allCorrect } = req.body;

    if (!clueId || !puzzleDate || typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'Missing clueId, puzzleDate, or correct' });
    }

    const key = `quiz:${puzzleDate}:${clueId}`;
    const clueKey = `${puzzleDate}:${clueId}`;
    const hintsKey = `hints:${puzzleDate}:${clueId}`;
    const now = Date.now();

    // Get existing attempts or create new array
    let attempts = await kv.get(key) || [];

    // Add new attempt
    attempts.push({
      timestamp: now,
      correct
    });

    // Store attempts
    await kv.set(key, attempts);

    // Update hints available for next attempt
    let hintsAvailable = await kv.get(hintsKey);
    if (hintsAvailable === null && answerLength) {
      // Initialize hints to 2x answer length
      hintsAvailable = answerLength * 2;
    }

    // On correct answer (all letters right): next attempt gets (hints used - 1)
    // allCorrect means all letters were correct, even if hints were used
    // On incorrect: no change to hints available
    if (allCorrect && typeof hintsUsed === 'number') {
      hintsAvailable = Math.max(0, hintsUsed - 1);
      await kv.set(hintsKey, hintsAvailable);
    }

    // Also append to recent-attempts log for efficient incremental sync
    let recentAttempts = await kv.get(RECENT_ATTEMPTS_KEY) || [];

    // Clean up old entries (older than 7 days)
    const cutoff = now - RECENT_ATTEMPTS_MAX_AGE_MS;
    recentAttempts = recentAttempts.filter(a => a.timestamp > cutoff);

    // Add new attempt to log
    recentAttempts.push({
      clueKey,
      timestamp: now,
      correct
    });

    await kv.set(RECENT_ATTEMPTS_KEY, recentAttempts);

    // Calculate and return stats
    const stats = calculateStats(attempts);

    return res.status(200).json({ success: true, stats, hintsAvailable });
  } catch (error) {
    console.error('Error recording attempt:', error);
    return res.status(500).json({ error: 'Failed to record attempt' });
  }
}

async function getStats(req, res) {
  try {
    const { clueId, puzzleDate, answerLength } = req.query;

    if (!clueId || !puzzleDate) {
      return res.status(400).json({ error: 'Missing clueId or puzzleDate' });
    }

    const key = `quiz:${puzzleDate}:${clueId}`;
    const hintsKey = `hints:${puzzleDate}:${clueId}`;
    const attempts = await kv.get(key) || [];

    // Get or initialize hints
    let hintsAvailable = await kv.get(hintsKey);
    if (hintsAvailable === null && answerLength) {
      hintsAvailable = parseInt(answerLength) * 2;
    }

    const stats = calculateStats(attempts);

    return res.status(200).json({ stats, hintsAvailable });
  } catch (error) {
    console.error('Error getting stats:', error);
    return res.status(500).json({ error: 'Failed to get stats' });
  }
}

function calculateStats(attempts) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const total = attempts.length;
  const correct = attempts.filter(a => a.correct).length;

  const lastHour = attempts.filter(a => a.timestamp >= hourAgo);
  const lastDay = attempts.filter(a => a.timestamp >= dayAgo);
  const lastWeek = attempts.filter(a => a.timestamp >= weekAgo);

  return {
    lifetime: {
      total,
      correct,
      percent: total > 0 ? Math.round((correct / total) * 100) : null
    },
    lastHour: {
      total: lastHour.length,
      correct: lastHour.filter(a => a.correct).length,
      percent: lastHour.length > 0 ? Math.round((lastHour.filter(a => a.correct).length / lastHour.length) * 100) : null
    },
    lastDay: {
      total: lastDay.length,
      correct: lastDay.filter(a => a.correct).length,
      percent: lastDay.length > 0 ? Math.round((lastDay.filter(a => a.correct).length / lastDay.length) * 100) : null
    },
    lastWeek: {
      total: lastWeek.length,
      correct: lastWeek.filter(a => a.correct).length,
      percent: lastWeek.length > 0 ? Math.round((lastWeek.filter(a => a.correct).length / lastWeek.length) * 100) : null
    }
  };
}
