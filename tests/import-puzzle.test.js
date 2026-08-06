import { describe, it, expect } from 'vitest';
import {
  expandPatternForRebus,
  buildAnswerLookup,
  buildClueCells,
  hasRebus,
  letterAlignedPattern
} from '../api/import-puzzle.js';

describe('expandPatternForRebus', () => {
  it('returns pattern unchanged when answer is same length as pattern', () => {
    expect(expandPatternForRebus('CA_', 'CAT')).toBe('CA_');
  });

  it('returns pattern unchanged when answer is shorter than pattern', () => {
    expect(expandPatternForRebus('CATS', 'CAT')).toBe('CATS');
  });

  it('returns pattern unchanged when answer is missing', () => {
    expect(expandPatternForRebus('CA_', null)).toBe('CA_');
    expect(expandPatternForRebus('CA_', '')).toBe('CA_');
  });

  it('returns pattern unchanged when pattern is missing', () => {
    expect(expandPatternForRebus('', 'CAT')).toBe('');
    expect(expandPatternForRebus(null, 'CAT')).toBe(null);
  });

  it('expands a fully blank pattern to a longer blank pattern', () => {
    const result = expandPatternForRebus('___', 'CARD');
    expect(result).toBe('____');
    expect(result.length).toBe(4);
  });

  it('preserves known letters from end of pattern when expanding', () => {
    // Pattern "C__" (length 3), answer "CARD" (length 4)
    // Known: C at position 0 (distance 2 from end) → new position 4-1-2 = 1
    const result = expandPatternForRebus('C__', 'CARD');
    expect(result.length).toBe(4);
    expect(result[1]).toBe('C'); // C was distance 2 from end, stays distance 2 from end
  });

  it('preserves a letter at the end of pattern when expanding', () => {
    // Pattern "__T" (length 3), answer "CART" (length 4)
    // T is at position 2 (distance 0 from end) → new position 4-1-0 = 3
    const result = expandPatternForRebus('__T', 'CART');
    expect(result.length).toBe(4);
    expect(result[3]).toBe('T');
  });

  it('handles rebus where answer is much longer than pattern', () => {
    // Pattern "_" (length 1), answer "SANTA" (length 5)
    const result = expandPatternForRebus('_', 'SANTA');
    expect(result.length).toBe(5);
    expect(result).toBe('_____');
  });

  it('does not place a known letter beyond bounds when expanding', () => {
    // All letters should map to valid positions in the new pattern
    const result = expandPatternForRebus('AB_', 'ABCD');
    expect(result.length).toBe(4);
    // No character should be out of range
    expect(result).not.toContain('undefined');
    expect(result.length).toBe(4);
  });
});

describe('buildAnswerLookup', () => {
  it('returns empty object for empty archive data', () => {
    expect(buildAnswerLookup({ clues: {}, answers: {} })).toEqual({});
  });

  it('builds a lookup from across clues', () => {
    const archiveData = {
      clues: { across: ['1. First clue', '5. Second clue'] },
      answers: { across: ['HELLO', 'WORLD'] }
    };
    const lookup = buildAnswerLookup(archiveData);
    expect(lookup['across-1']).toBe('HELLO');
    expect(lookup['across-5']).toBe('WORLD');
  });

  it('builds a lookup from down clues', () => {
    const archiveData = {
      clues: { down: ['2. A down clue', '7. Another down clue'] },
      answers: { down: ['FOO', 'BAR'] }
    };
    const lookup = buildAnswerLookup(archiveData);
    expect(lookup['down-2']).toBe('FOO');
    expect(lookup['down-7']).toBe('BAR');
  });

  it('handles both across and down together', () => {
    const archiveData = {
      clues: {
        across: ['1. Across'],
        down: ['2. Down']
      },
      answers: {
        across: ['ACE'],
        down: ['AD']
      }
    };
    const lookup = buildAnswerLookup(archiveData);
    expect(lookup['across-1']).toBe('ACE');
    expect(lookup['down-2']).toBe('AD');
  });

  it('skips clue entries that do not start with a number', () => {
    const archiveData = {
      clues: { across: ['No number here', '3. Valid clue'] },
      answers: { across: ['SKIP', 'VALID'] }
    };
    const lookup = buildAnswerLookup(archiveData);
    expect(Object.keys(lookup)).toHaveLength(1);
    expect(lookup['across-3']).toBe('VALID');
  });

  it('skips entries where the answer is missing', () => {
    const archiveData = {
      clues: { across: ['1. First', '5. Second'] },
      answers: { across: ['HELLO', null] }
    };
    const lookup = buildAnswerLookup(archiveData);
    expect(lookup['across-1']).toBe('HELLO');
    expect(lookup['across-5']).toBeUndefined();
  });

  it('handles missing across or down sections gracefully', () => {
    const archiveData = {
      clues: { across: ['1. Only across'] },
      answers: { across: ['WORD'] }
    };
    expect(() => buildAnswerLookup(archiveData)).not.toThrow();
    const lookup = buildAnswerLookup(archiveData);
    expect(lookup['across-1']).toBe('WORD');
  });
});

describe('buildClueCells', () => {
  it('returns {} when the archive has no grid', () => {
    expect(buildClueCells({})).toEqual({});
    expect(buildClueCells({ grid: null, gridnums: null, size: null })).toEqual({});
  });

  // A tiny 3x3 grid:  C A T   (1A=CAT, 1D=COT)
  //                   O . .
  //                   T . .
  it('reconstructs across and down cell runs from a simple grid', () => {
    const archive = {
      size: { rows: 3, cols: 3 },
      grid: ['C', 'A', 'T', 'O', '.', '.', 'T', '.', '.'],
      gridnums: [1, 2, 3, 4, 0, 0, 5, 0, 0]
    };
    const cells = buildClueCells(archive);
    expect(cells['across-1']).toEqual(['C', 'A', 'T']);
    expect(cells['down-1']).toEqual(['C', 'O', 'T']);
  });

  it('captures a rebus square as a multi-letter cell', () => {
    // Row 0: D O [WSW] N   -> across answer DOWSWN spelling DO+WSW+N... use DOWNWARD-like
    // Simple: "H O [WSW]" across = HOWSW
    const archive = {
      size: { rows: 1, cols: 3 },
      grid: ['H', 'O', 'WSW'],
      gridnums: [1, 2, 3]
    };
    const cells = buildClueCells(archive);
    expect(cells['across-1']).toEqual(['H', 'O', 'WSW']);
  });
});

describe('hasRebus', () => {
  it('is true only when a cell holds more than one letter', () => {
    expect(hasRebus(['H', 'O', 'WSW', 'E'])).toBe(true);
    expect(hasRebus(['C', 'A', 'T'])).toBe(false);
    expect(hasRebus(undefined)).toBe(false);
    expect(hasRebus([])).toBe(false);
  });
});

describe('letterAlignedPattern', () => {
  it('expands a mid-word rebus cell to blanks, keeping surrounding hints', () => {
    // "Boxing the Compass" 26A: HO·[WSW]·EETITIS, captured cell-pattern HO_EETITIS
    const cells = ['H', 'O', 'WSW', 'E', 'E', 'T', 'I', 'T', 'I', 'S'];
    const result = letterAlignedPattern('HO_EETITIS', cells, 'HOWSWEETITIS');
    expect(result).toBe('HO___EETITIS');
    expect(result.length).toBe('HOWSWEETITIS'.length);
  });

  it('produces a pattern whose blanks line up with the rebus letters', () => {
    const cells = ['J', 'A', 'NNW', 'E', 'N', 'N', 'E', 'R'];
    const result = letterAlignedPattern('_A_____R', cells, 'JANNWENNER');
    expect(result).toBe('_A_______R');
    // Only the given A and R survive as hints; both align to the answer.
    expect(result[1]).toBe('A');
    expect(result[result.length - 1]).toBe('R');
  });

  it('drops a captured hint letter that disagrees with the answer', () => {
    // 110D: answer PLAINNESS, captured PLAI_ST — the trailing T is wrong (should be S)
    const cells = ['P', 'L', 'A', 'I', 'NNE', 'S', 'S'];
    const result = letterAlignedPattern('PLAI_ST', cells, 'PLAINNESS');
    expect(result).toBe('PLAI___S_');
    expect(result.length).toBe('PLAINNESS'.length);
  });

  it('is a faithful passthrough for a non-rebus clue', () => {
    const cells = ['C', 'A', 'T'];
    expect(letterAlignedPattern('C__', cells, 'CAT')).toBe('C__');
    expect(letterAlignedPattern('CA_', cells, 'CAT')).toBe('CA_');
  });
});
