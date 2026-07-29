// Check if a clue has a complete answer (answer length matches pattern length)
export function hasCompleteAnswer(clue) {
  const answer = clue.answer || '';
  const pattern = clue.pattern || '';
  return answer.length > 0 && answer.length === pattern.length;
}

// A clue is "solved" when the current grid state (pattern) is a complete,
// correct copy of the answer. Blank, partially filled, or incorrect => unsolved.
// With no known answer we can't confirm a solve, so it counts as unsolved.
export function isClueSolved(clue) {
  const answer = (clue.answer || '').toUpperCase();
  const pattern = (clue.pattern || '').toUpperCase();
  if (!answer) return false;
  if (pattern.length !== answer.length) return false;
  if (pattern.includes('_')) return false;
  return pattern === answer;
}

// Count the squares (letter cells) in a single clue that are not yet correctly
// filled — blank, wrong, or missing all count as unsolved.
export function unsolvedSquaresInClue(clue) {
  const answer = (clue.answer || '').toUpperCase();
  const pattern = (clue.pattern || '').toUpperCase();
  const len = answer.length || pattern.length;
  let count = 0;
  for (let i = 0; i < len; i++) {
    const a = answer[i];
    const p = pattern[i];
    if (a) {
      if (p !== a) count++; // blank, wrong, or missing letter
    } else if (!p || p === '_') {
      count++; // answer unknown and cell not filled
    }
  }
  return count;
}

// Aggregate unsolved counts for one puzzle record. Ignored clues are excluded.
// Squares are counted from across entries only: in a standard grid every white
// square belongs to exactly one across entry, so each is counted once (no
// double-counting of crossing squares). Falls back to down entries if a record
// happens to hold no across clues.
export function puzzleUnsolvedStats(record) {
  const clues = (record.clues || []).filter(c => !c.ignored);
  const unsolvedClues = clues.filter(c => !isClueSolved(c)).length;

  const across = clues.filter(c => c.direction === 'across');
  const squareClues = across.length > 0 ? across : clues.filter(c => c.direction === 'down');
  const unsolvedSquares = squareClues.reduce((sum, c) => sum + unsolvedSquaresInClue(c), 0);

  return { unsolvedClues, unsolvedSquares };
}
