import { describe, it, expect, vi } from 'vitest';
import { apiHandler } from '../../api/utils/api-handler.js';

function mockReqRes(method) {
  const req = { method };
  const res = {
    statusCode: null,
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { this.ended = true; return this; },
  };
  return { req, res };
}

describe('apiHandler', () => {
  it('returns 200 for OPTIONS preflight', async () => {
    const handler = apiHandler({ GET: vi.fn() });
    const { req, res } = mockReqRes('OPTIONS');

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
  });

  it('returns 405 for unsupported methods', async () => {
    const handler = apiHandler({ GET: vi.fn() });
    const { req, res } = mockReqRes('DELETE');

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('delegates to the correct method handler', async () => {
    const getHandler = vi.fn((req, res) => res.status(200).json({ ok: true }));
    const postHandler = vi.fn();
    const handler = apiHandler({ GET: getHandler, POST: postHandler });
    const { req, res } = mockReqRes('GET');

    await handler(req, res);

    expect(getHandler).toHaveBeenCalledWith(req, res);
    expect(postHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('delegates POST to the POST handler', async () => {
    const postHandler = vi.fn((req, res) => res.status(201).json({ created: true }));
    const handler = apiHandler({ GET: vi.fn(), POST: postHandler });
    const { req, res } = mockReqRes('POST');

    await handler(req, res);

    expect(postHandler).toHaveBeenCalledWith(req, res);
    expect(res.statusCode).toBe(201);
  });

  it('handles async method handlers', async () => {
    const asyncHandler = vi.fn(async (req, res) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      res.status(200).json({ async: true });
    });
    const handler = apiHandler({ GET: asyncHandler });
    const { req, res } = mockReqRes('GET');

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ async: true });
  });
});
