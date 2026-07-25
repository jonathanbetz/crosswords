import { describe, it, expect } from 'vitest';
import { hasCompleteAnswer } from '../../lib/clue.js';

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
