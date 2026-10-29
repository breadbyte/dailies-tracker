import { describe, expect, it, vi } from 'vitest';
import { createWorker, type VerifyIdToken } from '../src/index.ts';
import type { Env } from '../src/env.ts';

const PROJECT_ID = 'example-project';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGINS: '',
    FIREBASE_PROJECT_ID: PROJECT_ID,
    ...overrides,
  };
}

function request(
  path: string,
  init?: RequestInit,
): Request {
  return new Request(`https://worker.test${path}`, init);
}

function workerWith(
  verifyIdToken: VerifyIdToken,
) {
  return createWorker({ verifyIdToken });
}

describe('account endpoint', () => {
  it('requires a bearer token', async () => {
    const verify = vi.fn();
    const response = await workerWith(verify).fetch!(
      request('/api/v1/account'),
      env(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a malformed authorization header', async () => {
    const verify = vi.fn();
    const response = await workerWith(verify).fetch!(
      request('/api/v1/account', {
        headers: { authorization: 'Token abc' },
      }),
      env(),
    );

    expect(response.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns only the identity proven by the verified token', async () => {
    const verify = vi.fn().mockResolvedValue({
      uid: 'uid-1',
      email: 'player@example.com',
      emailVerified: true,
    });
    const response = await workerWith(verify).fetch!(
      request('/api/v1/account', {
        headers: { authorization: 'Bearer id-token' },
      }),
      env(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      uid: 'uid-1',
      email: 'player@example.com',
      emailVerified: true,
    });
    expect(verify).toHaveBeenCalledWith('id-token', PROJECT_ID);
  });

  it('does not reveal why token verification failed', async () => {
    const verify = vi
      .fn()
      .mockRejectedValue(new Error('signature or issuer detail'));
    const response = await workerWith(verify).fetch!(
      request('/api/v1/account', {
        headers: { authorization: 'Bearer bad-token' },
      }),
      env(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('is disabled when no Firebase project ID is configured', async () => {
    const verify = vi.fn();
    const response = await workerWith(verify).fetch!(
      request('/api/v1/account', {
        headers: { authorization: 'Bearer id-token' },
      }),
      env({ FIREBASE_PROJECT_ID: '' }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'auth_not_configured' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    const response = await workerWith(vi.fn()).fetch!(
      request('/api/v1/account', { method: 'POST' }),
      env(),
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'method_not_allowed' });
  });
});

describe('Worker CORS', () => {
  it('allows configured origins and answers preflight requests', async () => {
    const worker = workerWith(vi.fn());
    const allowed = env({ ALLOWED_ORIGINS: 'https://app.example' });

    const preflight = await worker.fetch!(
      request('/api/v1/account', {
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
    expect(preflight.headers.get('access-control-allow-headers')).toBe(
      'Authorization',
    );
    expect(preflight.headers.get('vary')).toBe('Origin');

    const response = await worker.fetch!(
      request('/api/v1/health', {
        headers: { origin: 'https://app.example' },
      }),
      allowed,
    );
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://app.example',
    );
  });

  it('rejects browser origins that are not configured', async () => {
    const response = await workerWith(vi.fn()).fetch!(
      request('/api/v1/health', {
        headers: { origin: 'https://other.example' },
      }),
      env({ ALLOWED_ORIGINS: 'https://app.example' }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not require CORS for non-browser callers', async () => {
    const response = await workerWith(vi.fn()).fetch!(
      request('/api/v1/health'),
      env(),
    );

    expect(response.status).toBe(200);
  });
});
