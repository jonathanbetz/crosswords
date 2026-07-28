import { describe, it, expect } from 'vitest';
import {
  mergeCapturedClues,
  shouldIgnoreSolvedClue,
  applySolvedSync
} from '../api/clues.js';

describe('mergeCapturedClues', () => {
  it('adds new clues when there is no existing record', () => {
    const incoming = [{ number: 1, direction: 'across', text: 'A', pattern: '___' }];
    expect(mergeCapturedClues(undefined, incoming)).toEqual(incoming);
  });

  it('preserves answer and ignored on existing clues while updating text/pattern', () => {
    const existing = [
      { number: 1, direction: 'across', text: 'Old', pattern: '___', answer: 'CAT', ignored: true }
    ];
    const incoming = [
      { number: 1, direction: 'across', text: 'New', pattern: 'C__' }
    ];
    const merged = mergeCapturedClues(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      number: 1, direction: 'across', text: 'New', pattern: 'C__', answer: 'CAT', ignored: true
    });
  });

  it('keeps existing clues that are absent from the capture', () => {
    const existing = [
      { number: 1, direction: 'across', text: 'One', pattern: 'CAT', answer: 'CAT' },
      { number: 2, direction: 'down', text: 'Two', pattern: '___', answer: 'DOG' }
    ];
    const incoming = [{ number: 2, direction: 'down', text: 'Two', pattern: 'D__' }];
    const merged = mergeCapturedClues(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find(c => c.number === 1).answer).toBe('CAT');
    expect(merged.find(c => c.number === 2).pattern).toBe('D__');
  });

  it('distinguishes across and down clues with the same number', () => {
    const existing = [{ number: 1, direction: 'across', text: 'A', pattern: '___', answer: 'CAT' }];
    const incoming = [{ number: 1, direction: 'down', text: 'D', pattern: '___' }];
    const merged = mergeCapturedClues(existing, incoming);
    expect(merged).toHaveLength(2);
  });
});

describe('shouldIgnoreSolvedClue', () => {
  const clue = { number: 1, direction: 'across', pattern: 'C__', answer: 'CAT', ignored: false };

  it('ignores a clue that was unsolved in our data but is solved correctly on the page', () => {
    expect(shouldIgnoreSolvedClue(clue, 'CAT')).toBe(true);
  });

  it('is case-insensitive when comparing the page pattern to the answer', () => {
    expect(shouldIgnoreSolvedClue(clue, 'cat')).toBe(true);
  });

  it('does not ignore when the page is filled but incorrect', () => {
    expect(shouldIgnoreSolvedClue(clue, 'COT')).toBe(false);
  });

  it('does not ignore when the page is not fully filled', () => {
    expect(shouldIgnoreSolvedClue(clue, 'CA_')).toBe(false);
    expect(shouldIgnoreSolvedClue(clue, null)).toBe(false);
  });

  it('does not ignore when we have no known answer to verify against', () => {
    expect(shouldIgnoreSolvedClue({ ...clue, answer: null }, 'CAT')).toBe(false);
  });

  it('leaves already-ignored clues untouched', () => {
    expect(shouldIgnoreSolvedClue({ ...clue, ignored: true }, 'CAT')).toBe(false);
  });

  it('does not re-ignore a clue that was already solved in our data', () => {
    // Stored pattern already equals the answer → it was not "unsolved in our data"
    expect(shouldIgnoreSolvedClue({ ...clue, pattern: 'CAT' }, 'CAT')).toBe(false);
  });

  it('ignores a rebus clue whose stored pattern is blank of the answer length', () => {
    const rebus = { number: 2, direction: 'down', pattern: '_____', answer: 'SANTA', ignored: false };
    expect(shouldIgnoreSolvedClue(rebus, 'SANTA')).toBe(true);
  });
});

describe('applySolvedSync', () => {
  const clues = [
    { number: 1, direction: 'across', pattern: 'C__', answer: 'CAT', ignored: false },
    { number: 2, direction: 'down', pattern: '___', answer: 'DOG', ignored: false },
    { number: 3, direction: 'across', pattern: '____', answer: 'BIRD', ignored: false }
  ];

  it('flips only the solved-and-correct clues to ignored', () => {
    const solved = [
      { number: 1, direction: 'across', pattern: 'CAT' }, // correct → ignore
      { number: 3, direction: 'across', pattern: 'BIRT' } // wrong → keep
    ];
    const { clues: updated, ignoredCount } = applySolvedSync(clues, solved);
    expect(ignoredCount).toBe(1);
    expect(updated.find(c => c.number === 1).ignored).toBe(true);
    expect(updated.find(c => c.number === 2).ignored).toBe(false);
    expect(updated.find(c => c.number === 3).ignored).toBe(false);
  });

  it('matches solved entries by direction, not just number', () => {
    const solved = [{ number: 1, direction: 'down', pattern: 'CAT' }]; // no down-1 exists
    const { ignoredCount } = applySolvedSync(clues, solved);
    expect(ignoredCount).toBe(0);
  });

  it('normalizes direction casing on incoming solved entries', () => {
    const solved = [{ number: 1, direction: 'Across', pattern: 'CAT' }];
    const { ignoredCount } = applySolvedSync(clues, solved);
    expect(ignoredCount).toBe(1);
  });

  it('is a no-op when nothing is solved', () => {
    const { clues: updated, ignoredCount } = applySolvedSync(clues, []);
    expect(ignoredCount).toBe(0);
    expect(updated).toEqual(clues);
  });

  it('tolerates a missing solved argument', () => {
    const { ignoredCount } = applySolvedSync(clues, undefined);
    expect(ignoredCount).toBe(0);
  });
});
