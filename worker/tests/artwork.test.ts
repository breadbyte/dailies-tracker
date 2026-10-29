import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../src/index.ts';
import type { Env } from '../src/env.ts';

const API_KEY = 'test-steamgriddb-key';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGINS: '',
    STEAMGRIDDB_API_KEY: API_KEY,
    ...overrides,
  };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://worker.test${path}`, init);
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

const searchBody = {
  success: true,
  data: [
    { id: 9569, name: 'Stardew Valley' },
    { id: 1, name: 'Stardew Valley Expanded' },
  ],
};

const gridsBody = {
  success: true,
  data: [
    {
      id: 1,
      score: 0,
      width: 600,
      height: 900,
      url: 'https://cdn2.steamgriddb.com/grid/1.png',
      thumb: 'https://cdn2.steamgriddb.com/thumb/1.jpg',
      nsfw: false,
    },
    {
      id: 2,
      score: 12,
      width: 600,
      height: 900,
      url: 'https://cdn2.steamgriddb.com/grid/2.png',
      thumb: 'https://cdn2.steamgriddb.com/thumb/2.jpg',
      nsfw: false,
    },
  ],
};

function artworkWorker(fetcher: typeof fetch) {
  return createWorker({
    verifyIdToken: vi.fn(),
    steamGridDbFetch: fetcher,
  });
}

describe('artwork proxy', () => {
  it('resolves the exact game, filters image fields, and sorts by score', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(searchBody))
      .mockResolvedValueOnce(jsonResponse(gridsBody)) as unknown as typeof fetch;
    const worker = artworkWorker(fetcher);

    const response = await worker.fetch(
      request('/api/v1/artwork?name=Stardew%20Valley'),
      env(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('max-age=3600');
    expect(await response.json()).toEqual({
      match: { id: 9569, name: 'Stardew Valley' },
      images: [
        {
          id: 2,
          score: 12,
          width: 600,
          height: 900,
          url: 'https://cdn2.steamgriddb.com/grid/2.png',
          thumb: 'https://cdn2.steamgriddb.com/thumb/2.jpg',
        },
        {
          id: 1,
          score: 0,
          width: 600,
          height: 900,
          url: 'https://cdn2.steamgriddb.com/grid/1.png',
          thumb: 'https://cdn2.steamgriddb.com/thumb/1.jpg',
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const [searchUrl, searchInit] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(searchUrl)).toContain('/search/autocomplete/Stardew%20Valley');
    expect(
      (searchInit?.headers as Record<string, string> | undefined)
        ?.authorization,
    ).toBe(`Bearer ${API_KEY}`);
    expect(String(vi.mocked(fetcher).mock.calls[1]?.[0])).toContain(
      '/grids/game/9569?types=static',
    );
  });

  it('returns a no-match result without requesting grids', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [] })) as unknown as typeof fetch;
    const worker = artworkWorker(fetcher);

    const response = await worker.fetch(
      request('/api/v1/artwork?name=Unknown%20Game'),
      env(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ match: null, images: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects missing names and reports an unconfigured proxy', async () => {
    const worker = artworkWorker(vi.fn() as unknown as typeof fetch);

    const missing = await worker.fetch(
      request('/api/v1/artwork?name='),
      env(),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid_name' });

    const unconfigured = await worker.fetch(
      request('/api/v1/artwork?name=Stardew%20Valley'),
      env({ STEAMGRIDDB_API_KEY: '' }),
    );
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({
      error: 'artwork_not_configured',
    });
  });

  it('rejects unsupported methods and answers CORS preflight', async () => {
    const worker = artworkWorker(vi.fn() as unknown as typeof fetch);
    const allowed = env({ ALLOWED_ORIGINS: 'https://app.example' });

    const post = await worker.fetch(
      request('/api/v1/artwork?name=Game', { method: 'POST' }),
      allowed,
    );
    expect(post.status).toBe(405);

    const preflight = await worker.fetch(
      request('/api/v1/artwork?name=Game', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example',
          'access-control-request-method': 'GET',
        },
      }),
      allowed,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://app.example',
    );
  });

  it('passes through rate limits with Retry-After and hides upstream details', async () => {
    const limited = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: 'rate_limited' },
        { status: 429, headers: { 'retry-after': '7' } },
      ),
    ) as unknown as typeof fetch;
    const limitedWorker = artworkWorker(limited);

    const limitedResponse = await limitedWorker.fetch(
      request('/api/v1/artwork?name=Stardew%20Valley'),
      env(),
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('retry-after')).toBe('7');
    expect(await limitedResponse.json()).toEqual({
      error: 'upstream_unavailable',
    });

    const failed = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'internal detail' }, { status: 500 }),
    ) as unknown as typeof fetch;
    const failedResponse = await artworkWorker(failed).fetch(
      request('/api/v1/artwork?name=Stardew%20Valley'),
      env(),
    );
    expect(failedResponse.status).toBe(502);
    expect(await failedResponse.json()).toEqual({
      error: 'upstream_unavailable',
    });
  });
});
