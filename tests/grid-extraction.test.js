import { describe, it, expect } from 'vitest';

// Mirrors of the pure grid-geometry helpers in chrome-extension/content.js —
// kept in sync by hand, since content.js is a non-module browser script and
// can't be imported. These reproduce the coordinate-ranking that replaced the
// old hardcoded 33px cell size (which mis-mapped 21x21 grids that use smaller
// cells).

function coordinateTracks(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const tracks = [];
  for (const v of sorted) {
    if (tracks.length === 0 || v - tracks[tracks.length - 1] > 1) {
      tracks.push(v);
    }
  }
  return tracks;
}

function nearestTrackIndex(tracks, value) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < tracks.length; i++) {
    const dist = Math.abs(tracks[i] - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// Simplified mirror of buildGridFromRawCells + getAnswerPattern, enough to
// assert that patterns come out at the right length/content regardless of the
// pixel cell size.
function buildGrid(rawCells) {
  const colTracks = coordinateTracks(rawCells.map(c => c.x));
  const rowTracks = coordinateTracks(rawCells.map(c => c.y));
  const size = Math.max(rowTracks.length, colTracks.length);
  const cells = new Array(size * size).fill(null).map(() => ({ isBlack: false, letter: null, cellNumber: null }));
  const cellsByNumber = new Map();
  for (const c of rawCells) {
    const row = nearestTrackIndex(rowTracks, c.y);
    const col = nearestTrackIndex(colTracks, c.x);
    cells[row * size + col] = { isBlack: c.isBlack, letter: c.letter, cellNumber: c.cellNumber };
    if (c.cellNumber) cellsByNumber.set(c.cellNumber, { row, col });
  }
  return { size, cells, cellsByNumber, getCell(r, c) {
    if (r < 0 || r >= size || c < 0 || c >= size) return null;
    return cells[r * size + c];
  } };
}

function answerPattern(clueNumber, direction, grid) {
  const start = grid.cellsByNumber.get(clueNumber);
  if (!start) return null;
  let { row: r, col: c } = start;
  const out = [];
  while (r < grid.size && c < grid.size) {
    const cell = grid.getCell(r, c);
    if (!cell || cell.isBlack) break;
    out.push(cell.letter || '_');
    if (direction === 'across') c++; else r++;
  }
  return out.join('');
}

// Build a synthetic row of white cells for a horizontal word, plus a trailing
// black cell, using an arbitrary cell size + offset.
function makeRow({ rowY, startX, step, letters, numberAtStart }) {
  const cells = [];
  letters.split('').forEach((ch, i) => {
    cells.push({
      x: startX + i * step,
      y: rowY,
      isBlack: false,
      letter: ch === '_' ? null : ch,
      cellNumber: i === 0 && numberAtStart ? numberAtStart : null
    });
  });
  // trailing black cell terminates the word
  cells.push({ x: startX + letters.length * step, y: rowY, isBlack: true, letter: null, cellNumber: null });
  return cells;
}

describe('coordinateTracks', () => {
  it('collapses equal coordinates into one track', () => {
    expect(coordinateTracks([3, 36, 3, 69, 36])).toEqual([3, 36, 69]);
  });

  it('tolerates sub-pixel jitter within 1px', () => {
    expect(coordinateTracks([3, 3.4, 36, 36.2])).toEqual([3, 36]);
  });

  it('returns tracks in ascending order', () => {
    expect(coordinateTracks([100, 10, 55])).toEqual([10, 55, 100]);
  });
});

describe('nearestTrackIndex', () => {
  const tracks = [3, 27, 51, 75];
  it('maps a coordinate to its column/row index', () => {
    expect(nearestTrackIndex(tracks, 27)).toBe(1);
    expect(nearestTrackIndex(tracks, 75)).toBe(3);
  });
  it('snaps a slightly-off coordinate to the nearest track', () => {
    expect(nearestTrackIndex(tracks, 26)).toBe(1);
  });
});

describe('grid extraction is independent of cell size', () => {
  // The original bug: a 21x21 grid renders with cells smaller than 33px, so
  // round((x-3)/33) scrambled the mapping. With coordinate ranking, any step
  // size resolves to a clean 0..n grid.
  it('extracts a 4-letter word correctly at a 24px cell size (was truncated before)', () => {
    // "DUEL" at row 0, starting col 0, 24px cells with a 5px offset
    const raw = makeRow({ rowY: 5, startX: 5, step: 24, letters: 'DUEL', numberAtStart: 21 });
    const grid = buildGrid(raw);
    expect(answerPattern(21, 'across', grid)).toBe('DUEL');
  });

  it('preserves blanks in a partially filled word', () => {
    const raw = makeRow({ rowY: 5, startX: 5, step: 24, letters: 'MA__', numberAtStart: 45 });
    const grid = buildGrid(raw);
    expect(answerPattern(45, 'across', grid)).toBe('MA__');
  });

  it('does not truncate long themed answers', () => {
    const raw = makeRow({ rowY: 5, startX: 5, step: 20, letters: 'BUTWHYCANTIWEARIT', numberAtStart: 16 });
    const grid = buildGrid(raw);
    expect(answerPattern(16, 'across', grid)).toBe('BUTWHYCANTIWEARIT');
  });
});
