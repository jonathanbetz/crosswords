import { describe, it, expect } from 'vitest';
import { expandPatternForRebus, buildAnswerLookup } from '../api/import-puzzle.js';

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
