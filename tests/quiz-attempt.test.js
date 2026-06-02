import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @vercel/kv before importing the module under test
const mockKv = {
  get: vi.fn(),
  set: vi.fn()
};
vi.mock('@vercel/kv', () => ({ kv: mockKv }));

// Import after mock is registered
const { default: handler } = await import('../api/quiz-attempt.js');

function makeReq(body = {}, query = {}) {
  return { body, query, method: 'POST' };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  mockKv.set.mockResolvedValue('OK');
});

describe('POST /api/quiz-attempt (recordAttempt)', () => {
  it('returns 400 when clueId is missing', async () => {
    const req = makeReq({ puzzleDate: '2024-01-01', correct: true });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when puzzleDate is missing', async () => {
    const req = makeReq({ clueId: 'across-1', correct: true });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when correct is not a boolean', async () => {
    const req = makeReq({ clueId: 'across-1', puzzleDate: '2024-01-01', correct: 'yes' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('appends the new attempt to KV and returns 200', async () => {
    const existing = [{ timestamp: 1000, correct: false }];
    mockKv.get
      .mockResolvedValueOnce(existing)  // quiz key
      .mockResolvedValueOnce(null)      // hints key
      .mockResolvedValueOnce([]);       // recent-attempts key

    const req = makeReq({ clueId: 'across-1', puzzleDate: '2024-01-01', correct: true });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // The quiz key should have been written with the new attempt appended
    const [quizKey, savedAttempts] = mockKv.set.mock.calls[0];
    expect(quizKey).toBe('quiz:2024-01-01:across-1');
    expect(savedAttempts).toHaveLength(2);
    expect(savedAttempts[1].correct).toBe(true);
  });

  it('initializes hintsAvailable to 2x answerLength when not stored', async () => {
    mockKv.get
      .mockResolvedValueOnce([])   // quiz key (no existing attempts)
      .mockResolvedValueOnce(null) // hints key (not initialized)
      .mockResolvedValueOnce([]); // recent-attempts key

    const req = makeReq({
      clueId: 'across-5',
      puzzleDate: '2024-01-01',
      correct: false,
      answerLength: 4
      // allCorrect not provided - neither hint branch fires, hints stay at init value
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.hintsAvailable).toBe(8); // answerLength * 2 = 8, no update because allCorrect is undefined
  });

  it('decrements hints to (hintsUsed - 1) on a correct answer', async () => {
    mockKv.get
      .mockResolvedValueOnce([])  // quiz key
      .mockResolvedValueOnce(6)   // hints key = 6 available
      .mockResolvedValueOnce([]); // recent-attempts

    const req = makeReq({
      clueId: 'across-1',
      puzzleDate: '2024-01-01',
      correct: true,
      allCorrect: true,
      hintsUsed: 3
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // hintsAvailable returned should be hintsUsed - 1 = 2
    expect(res.body.hintsAvailable).toBe(2);
  });

  it('increments hints by 1 on an incorrect answer', async () => {
    mockKv.get
      .mockResolvedValueOnce([])  // quiz key
      .mockResolvedValueOnce(4)   // hints key = 4 available
      .mockResolvedValueOnce([]); // recent-attempts

    const req = makeReq({
      clueId: 'across-1',
      puzzleDate: '2024-01-01',
      correct: false,
      allCorrect: false,
      hintsUsed: 2
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.hintsAvailable).toBe(5);
  });

  it('does not update hints when allCorrect is not provided', async () => {
    mockKv.get
      .mockResolvedValueOnce([])  // quiz key
      .mockResolvedValueOnce(4)   // hints key
      .mockResolvedValueOnce([]); // recent-attempts

    const req = makeReq({
      clueId: 'across-1',
      puzzleDate: '2024-01-01',
      correct: true
      // allCorrect not provided
    });
    const res = makeRes();
    await handler(req, res);

    // hints key should not have been written (only quiz key and recent-attempts key)
    const hintSetCalls = mockKv.set.mock.calls.filter(([k]) => k.startsWith('hints:'));
    expect(hintSetCalls).toHaveLength(0);
  });

  it('returns stats object with lifetime, lastHour, lastDay, lastWeek', async () => {
    mockKv.get
      .mockResolvedValueOnce([])  // quiz key
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([]);

    const req = makeReq({ clueId: 'across-1', puzzleDate: '2024-01-01', correct: true });
    const res = makeRes();
    await handler(req, res);

    expect(res.body.stats).toHaveProperty('lifetime');
    expect(res.body.stats).toHaveProperty('lastHour');
    expect(res.body.stats).toHaveProperty('lastDay');
    expect(res.body.stats).toHaveProperty('lastWeek');
    expect(res.body.stats.lifetime.total).toBe(1);
    expect(res.body.stats.lifetime.correct).toBe(1);
  });

  it('records attempt in the recent-attempts log', async () => {
    mockKv.get
      .mockResolvedValueOnce([])   // quiz key
      .mockResolvedValueOnce(null) // hints key
      .mockResolvedValueOnce([]);  // recent-attempts (empty)

    const req = makeReq({ clueId: 'across-3', puzzleDate: '2024-06-01', correct: false });
    const res = makeRes();
    await handler(req, res);

    const recentSetCall = mockKv.set.mock.calls.find(([k]) => k === 'quiz:recent-attempts');
    expect(recentSetCall).toBeDefined();
    const saved = recentSetCall[1];
    expect(saved[saved.length - 1].clueKey).toBe('2024-06-01:across-3');
    expect(saved[saved.length - 1].correct).toBe(false);
  });
});

describe('GET /api/quiz-attempt (getStats)', () => {
  it('returns 400 when clueId or puzzleDate is missing', async () => {
    const req = { method: 'GET', query: { clueId: 'across-1' }, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns stats and hintsAvailable', async () => {
    const attempts = [
      { timestamp: Date.now() - 1000, correct: true },
      { timestamp: Date.now() - 500, correct: false }
    ];
    mockKv.get
      .mockResolvedValueOnce(attempts) // quiz key
      .mockResolvedValueOnce(8);       // hints key

    const req = { method: 'GET', query: { clueId: 'across-1', puzzleDate: '2024-01-01' }, body: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.stats.lifetime.total).toBe(2);
    expect(res.body.stats.lifetime.correct).toBe(1);
    expect(res.body.hintsAvailable).toBe(8);
  });

  it('initializes hintsAvailable from answerLength when not stored', async () => {
    mockKv.get
      .mockResolvedValueOnce([])   // quiz key
      .mockResolvedValueOnce(null); // hints key

    const req = { method: 'GET', query: { clueId: 'across-1', puzzleDate: '2024-01-01', answerLength: '5' }, body: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.body.hintsAvailable).toBe(10); // 5 * 2
  });
});
