import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cacheMaxAgeMs,
  createFirebaseKeyResolver,
  verifyFirebaseIdToken,
} from '../src/auth.ts';

const PROJECT_ID = 'example-project';
const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

interface TokenOptions {
  payload?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  subject?: string | null;
  kid?: string | null;
  authTime?: number | null;
  issuedAt?: number;
  expiresAt?: number;
  signingKey?: CryptoKey;
}

function signToken(options: TokenOptions = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    email: 'player@example.com',
    email_verified: true,
    ...(options.authTime === null
      ? {}
      : { auth_time: options.authTime ?? NOW_SECONDS }),
    ...(options.subject === null
      ? {}
      : { sub: options.subject ?? 'uid-1' }),
    ...(options.payload ?? {}),
  };

  return new SignJWT(payload)
    .setProtectedHeader({
      alg: 'RS256',
      ...(options.kid === null ? {} : { kid: options.kid ?? 'kid-1' }),
    })
    .setIssuer(
      options.issuer ?? `https://securetoken.google.com/${PROJECT_ID}`,
    )
    .setAudience(options.audience ?? PROJECT_ID)
    .setIssuedAt(options.issuedAt ?? NOW_SECONDS)
    .setExpirationTime(options.expiresAt ?? NOW_SECONDS + 3600)
    .sign(options.signingKey ?? privateKey);
}

function verify(token: string) {
  return verifyFirebaseIdToken(token, {
    projectId: PROJECT_ID,
    getKey: async () => publicKey,
    now: () => NOW_MS,
  });
}

describe('Firebase ID token verification', () => {
  it('returns the identity from a valid token', async () => {
    await expect(verify(await signToken())).resolves.toEqual({
      uid: 'uid-1',
      email: 'player@example.com',
      emailVerified: true,
    });
  });

  it('returns a null email when the token has none', async () => {
    const token = await signToken({
      payload: { email: undefined, email_verified: undefined },
    });

    await expect(verify(token)).resolves.toEqual({
      uid: 'uid-1',
      email: null,
      emailVerified: false,
    });
  });

  it('rejects the wrong audience', async () => {
    await expect(
      verify(await signToken({ audience: 'another-project' })),
    ).rejects.toThrow();
  });

  it('rejects the wrong issuer', async () => {
    await expect(
      verify(
        await signToken({
          issuer: 'https://securetoken.google.com/another-project',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    await expect(
      verify(await signToken({ expiresAt: NOW_SECONDS - 60 })),
    ).rejects.toThrow();
  });

  it('rejects a token without a subject', async () => {
    await expect(verify(await signToken({ subject: null }))).rejects.toThrow();
  });

  it('rejects a token without auth_time', async () => {
    await expect(
      verify(await signToken({ authTime: null })),
    ).rejects.toThrow();
  });

  it('rejects a token without a key ID', async () => {
    await expect(verify(await signToken({ kid: null }))).rejects.toThrow();
  });

  it('rejects a token signed by a different key', async () => {
    const other = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    await expect(
      verify(await signToken({ signingKey: other.privateKey })),
    ).rejects.toThrow();
  });
});

function certificateResponse(kids: string[]): Response {
  return new Response(
    JSON.stringify(
      Object.fromEntries(kids.map((kid) => [kid, `pem-${kid}`])),
    ),
    { headers: { 'cache-control': 'public, max-age=600' } },
  );
}

describe('Firebase signing key cache', () => {
  it('parses Cache-Control max-age with safe bounds', () => {
    expect(cacheMaxAgeMs('public, max-age=120')).toBe(120_000);
    expect(cacheMaxAgeMs('max-age=1')).toBe(60_000);
    expect(cacheMaxAgeMs('max-age=999999')).toBe(86_400_000);
    expect(cacheMaxAgeMs(null)).toBe(3_600_000);
  });

  it('caches keys until the advertised lifetime expires', async () => {
    let now = NOW_MS;
    const fetcher = vi.fn(async () => certificateResponse(['kid-1']));
    const importer = vi.fn(
      async (pem: string) => ({ pem }) as unknown as CryptoKey,
    );
    const resolver = createFirebaseKeyResolver({
      fetcher: fetcher as unknown as typeof fetch,
      now: () => now,
      importer,
    });

    const first = await resolver.getKey('kid-1');
    const second = await resolver.getKey('kid-1');
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);

    now += 601_000;
    await resolver.getKey('kid-1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refreshes when an unknown key ID may indicate rotation', async () => {
    let now = NOW_MS;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(certificateResponse(['kid-1']))
      .mockResolvedValueOnce(certificateResponse(['kid-2']));
    const importer = vi.fn(
      async (pem: string) => ({ pem }) as unknown as CryptoKey,
    );
    const resolver = createFirebaseKeyResolver({
      fetcher: fetcher as unknown as typeof fetch,
      now: () => now,
      importer,
    });

    await resolver.getKey('kid-1');
    now += 61_000;
    const rotated = await resolver.getKey('kid-2');

    expect(rotated).toEqual({ pem: 'pem-kid-2' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed certificate request', async () => {
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const resolver = createFirebaseKeyResolver({
      fetcher: fetcher as unknown as typeof fetch,
      now: () => NOW_MS,
      importer: async (pem) => ({ pem }) as unknown as CryptoKey,
    });

    await expect(resolver.getKey('kid-1')).rejects.toThrow();
    await expect(resolver.getKey('kid-1')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
