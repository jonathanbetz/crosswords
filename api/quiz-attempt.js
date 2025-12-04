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

async function recordAttempt(req, res) {
  try {
    const { clueId, puzzleDate, correct } = req.body;

    if (!clueId || !puzzleDate || typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'Missing clueId, puzzleDate, or correct' });
    }

    const key = `quiz:${puzzleDate}:${clueId}`;
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

    // Calculate and return stats
    const stats = calculateStats(attempts);

    return res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error('Error recording attempt:', error);
    return res.status(500).json({ error: 'Failed to record attempt' });
  }
}

async function getStats(req, res) {
  try {
    const { clueId, puzzleDate } = req.query;

    if (!clueId || !puzzleDate) {
      return res.status(400).json({ error: 'Missing clueId or puzzleDate' });
    }

    const key = `quiz:${puzzleDate}:${clueId}`;
    const attempts = await kv.get(key) || [];

    const stats = calculateStats(attempts);

    return res.status(200).json({ stats });
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
