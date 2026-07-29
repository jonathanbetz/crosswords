import { describe, it, expect } from 'vitest';
import {
  hasCompleteAnswer,
  isClueSolved,
  unsolvedSquaresInClue,
  puzzleUnsolvedStats
} from '../../lib/clue.js';

describe('hasCompleteAnswer', () => {
  it('returns true when answer length matches pattern length', () => {
    expect(hasCompleteAnswer({ answer: 'CAT', pattern: '___' })).toBe(true);
  });

  it('returns false when answer is missing', () => {
    expect(hasCompleteAnswer({ pattern: '___' })).toBe(false);
  });

  it('returns false when pattern is missing', () => {
    expect(hasCompleteAnswer({ answer: 'CAT' })).toBe(false);
  });

  it('returns false when both are missing', () => {
    expect(hasCompleteAnswer({})).toBe(false);
  });

  it('returns false when answer is empty string', () => {
    expect(hasCompleteAnswer({ answer: '', pattern: '___' })).toBe(false);
  });

  it('returns false when answer length does not match pattern length', () => {
    expect(hasCompleteAnswer({ answer: 'CA', pattern: '___' })).toBe(false);
  });

  it('returns true for single-character clues', () => {
    expect(hasCompleteAnswer({ answer: 'A', pattern: '_' })).toBe(true);
  });

  it('returns false when answer is null', () => {
    expect(hasCompleteAnswer({ answer: null, pattern: '___' })).toBe(false);
  });

  it('returns false when pattern is null', () => {
    expect(hasCompleteAnswer({ answer: 'CAT', pattern: null })).toBe(false);
  });
});

describe('isClueSolved', () => {
  it('is solved when the pattern is complete and matches the answer', () => {
    expect(isClueSolved({ answer: 'CAT', pattern: 'CAT' })).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isClueSolved({ answer: 'CAT', pattern: 'cat' })).toBe(true);
  });

  it('is unsolved when the pattern has blanks', () => {
    expect(isClueSolved({ answer: 'CAT', pattern: 'C_T' })).toBe(false);
  });

  it('is unsolved when the pattern is filled but incorrect', () => {
    expect(isClueSolved({ answer: 'CAT', pattern: 'COT' })).toBe(false);
  });

  it('is unsolved when there is no known answer', () => {
    expect(isClueSolved({ pattern: 'CAT' })).toBe(false);
  });

  it('is unsolved when pattern and answer lengths differ', () => {
    expect(isClueSolved({ answer: 'CATS', pattern: 'CAT' })).toBe(false);
  });
});

describe('unsolvedSquaresInClue', () => {
  it('counts zero for a correctly solved clue', () => {
    expect(unsolvedSquaresInClue({ answer: 'CAT', pattern: 'CAT' })).toBe(0);
  });

  it('counts blank cells', () => {
    expect(unsolvedSquaresInClue({ answer: 'CAT', pattern: 'C__' })).toBe(2);
  });

  it('counts wrong cells', () => {
    expect(unsolvedSquaresInClue({ answer: 'CAT', pattern: 'COT' })).toBe(1);
  });

  it('counts cells missing beyond a short pattern', () => {
    expect(unsolvedSquaresInClue({ answer: 'CATS', pattern: 'CA' })).toBe(2);
  });

  it('counts all cells when the answer is unknown and the pattern is blank', () => {
    expect(unsolvedSquaresInClue({ pattern: '____' })).toBe(4);
  });
});

describe('puzzleUnsolvedStats', () => {
  it('counts unsolved clues in both directions and squares from across only', () => {
    const record = { clues: [
      { number: 1, direction: 'across', answer: 'CAT', pattern: 'C__' }, // unsolved, 2 blank squares
      { number: 2, direction: 'across', answer: 'DOG', pattern: 'DOG' }, // solved, 0 squares
      { number: 1, direction: 'down',   answer: 'CAR', pattern: 'C__' }  // unsolved clue, squares NOT counted (down)
    ] };
    const stats = puzzleUnsolvedStats(record);
    expect(stats.unsolvedClues).toBe(2);   // across-1 and down-1
    expect(stats.unsolvedSquares).toBe(2); // only across contributes
  });

  it('excludes ignored clues', () => {
    const record = { clues: [
      { number: 1, direction: 'across', answer: 'CAT', pattern: '___', ignored: true },
      { number: 2, direction: 'across', answer: 'DOG', pattern: 'D__' }
    ] };
    const stats = puzzleUnsolvedStats(record);
    expect(stats.unsolvedClues).toBe(1);
    expect(stats.unsolvedSquares).toBe(2);
  });

  it('falls back to down entries for squares when no across clues exist', () => {
    const record = { clues: [
      { number: 1, direction: 'down', answer: 'CAT', pattern: 'C__' }
    ] };
    const stats = puzzleUnsolvedStats(record);
    expect(stats.unsolvedSquares).toBe(2);
  });

  it('returns zeros for an empty record', () => {
    expect(puzzleUnsolvedStats({ clues: [] })).toEqual({ unsolvedClues: 0, unsolvedSquares: 0 });
    expect(puzzleUnsolvedStats({})).toEqual({ unsolvedClues: 0, unsolvedSquares: 0 });
  });
});
