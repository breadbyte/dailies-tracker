import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import type { Env } from '../src/env.ts';

const env: Env = { ALLOWED_ORIGINS: '' };

function request(path: string, init?: RequestInit) {
  return new Request(`https://worker.test${path}`, init);
}

describe('worker routes', () => {
  it('reports health without exposing operational detail', async () => {
    const response = await worker.fetch(request('/api/v1/health'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('rejects unsupported methods on the health route', async () => {
    const response = await worker.fetch(
      request('/api/v1/health', { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const response = await worker.fetch(request('/api/v1/unknown'), env);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});
