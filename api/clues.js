import { kv } from '@vercel/kv';
import { hasCompleteAnswer } from '../lib/clue.js';
import { apiHandler } from '../lib/api-handler.js';

export default apiHandler({ GET: getClues, POST: saveClues });

// Merge freshly-captured clues into an existing puzzle record's clues without
// clobbering the server-side fields we've already learned (answer, ignored).
// A captured clue that matches an existing one updates only its display fields
// (text, pattern); a new clue is added; existing clues absent from the capture
// are kept untouched.
export function mergeCapturedClues(existingClues, incomingClues) {
  const byId = new Map();
  for (const c of existingClues || []) {
    byId.set(`${c.direction}-${c.number}`, c);
  }
  for (const inc of incomingClues || []) {
    const id = `${inc.direction}-${inc.number}`;
    const existing = byId.get(id);
    if (existing) {
      byId.set(id, {
        ...existing,
        text: inc.text ?? existing.text,
        pattern: inc.pattern ?? existing.pattern
      });
    } else {
      byId.set(id, inc);
    }
  }
  return Array.from(byId.values());
}

// Decide whether a clue that shows as solved on the puzzle page should now be
// ignored: it must have been unsolved in our data, and be filled in correctly
// (matching the known answer) on the page.
export function shouldIgnoreSolvedClue(clue, pagePattern) {
  if (!clue || clue.ignored) return false;
  if (!pagePattern || pagePattern.includes('_')) return false; // not fully filled on page

  const answer = (clue.answer || '').toUpperCase();
  const page = pagePattern.toUpperCase();
  // We can only confirm "solved" when the filled letters match the correct answer.
  if (!answer || page !== answer) return false;

  // "Unsolved in our data" = our stored pattern isn't a complete, correct answer.
  const stored = (clue.pattern || '').toUpperCase();
  const solvedInData = stored.length > 0 && !stored.includes('_') && stored === answer;
  return !solvedInData;
}

// Given the merged clues and the clues the page reports as solved, flip the
// newly-solved ones to ignored. Returns the updated clues and a count.
export function applySolvedSync(clues, solved) {
  const lookup = {};
  for (const s of solved || []) {
    if (s && s.direction != null && s.number != null && s.pattern) {
      lookup[`${String(s.direction).toLowerCase()}-${s.number}`] = String(s.pattern).toUpperCase();
    }
  }

  let ignoredCount = 0;
  const updated = (clues || []).map(clue => {
    const pagePattern = lookup[`${clue.direction}-${clue.number}`];
    if (shouldIgnoreSolvedClue(clue, pagePattern)) {
      ignoredCount++;
      return { ...clue, ignored: true };
    }
    return clue;
  });

  return { clues: updated, ignoredCount };
}

async function saveClues(req, res) {
  try {
    const { puzzleDate, clues, solved } = req.body;

    if (!puzzleDate || !clues || !Array.isArray(clues)) {
      return res.status(400).json({ error: 'Missing puzzleDate or clues array' });
    }

    const key = `puzzle:${puzzleDate}`;
    const existing = await kv.get(key);

    // Merge captured clues non-destructively, then mark clues the page reports
    // as solved (and were unsolved in our data) as ignored.
    const mergedClues = mergeCapturedClues(existing && existing.clues, clues);
    const { clues: syncedClues, ignoredCount } = applySolvedSync(mergedClues, solved);

    const record = {
      ...(existing || {}),
      puzzleDate,
      clues: syncedClues,
      savedAt: (existing && existing.savedAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await kv.set(key, record);

    // Also add to list of all puzzle dates for easy retrieval
    await kv.sadd('puzzle:dates', puzzleDate);

    return res.status(200).json({ success: true, puzzleDate, ignoredCount });
  } catch (error) {
    console.error('Error saving clues:', error);
    return res.status(500).json({ error: 'Failed to save clues' });
  }
}

async function getClues(req, res) {
  try {
    const { date } = req.query;

    if (date) {
      // Get clues for specific puzzle date
      const key = `puzzle:${date}`;
      const record = await kv.get(key);

      if (!record) {
        return res.status(404).json({ error: 'Puzzle not found' });
      }

      // Fetch lifetime quiz stats for each clue (only for clues with complete answers)
      const cluesWithStats = await Promise.all(
        record.clues.map(async (clue) => {
          if (!hasCompleteAnswer(clue)) {
            return { ...clue, quizStats: null };
          }

          const clueId = `${clue.direction}-${clue.number}`;
          const quizKey = `quiz:${date}:${clueId}`;
          const attempts = await kv.get(quizKey) || [];

          const total = attempts.length;
          const correct = attempts.filter(a => a.correct).length;

          return {
            ...clue,
            quizStats: total > 0 ? { correct, total } : null
          };
        })
      );

      return res.status(200).json({ ...record, clues: cluesWithStats });
    } else {
      // Get list of all saved puzzle dates with summary stats
      const dates = await kv.smembers('puzzle:dates') || [];
      const sortedDates = dates.sort().reverse();

      // Fetch summary info for each puzzle
      const puzzles = await Promise.all(
        sortedDates.map(async (d) => {
          const record = await kv.get(`puzzle:${d}`);
          if (!record) return { date: d, total: 0, incomplete: 0, markedComplete: false };

          const nonIgnoredClues = record.clues.filter(c => !c.ignored);
          const total = nonIgnoredClues.length;
          const incomplete = nonIgnoredClues.filter(c => !hasCompleteAnswer(c)).length;

          return { date: d, total, incomplete, markedComplete: record.markedComplete || false };
        })
      );

      return res.status(200).json({ dates: sortedDates, puzzles });
    }
  } catch (error) {
    console.error('Error getting clues:', error);
    return res.status(500).json({ error: 'Failed to get clues', details: error.message });
  }
}
