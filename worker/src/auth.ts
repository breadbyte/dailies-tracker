import { importX509, jwtVerify } from 'jose';

const CERTIFICATE_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const DEFAULT_CACHE_SECONDS = 60 * 60;
const MIN_CACHE_SECONDS = 60;
const MAX_CACHE_SECONDS = 24 * 60 * 60;
const FORCED_REFRESH_INTERVAL_MS = 60 * 1000;

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface FirebaseKeyResolver {
  getKey(kid: string): Promise<CryptoKey>;
}

export interface FirebaseKeyResolverOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  importer?: (pem: string) => Promise<CryptoKey>;
}

export function cacheMaxAgeMs(header: string | null): number {
  const match =
    header === null ? null : /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i.exec(header);
  const seconds =
    match === null ? DEFAULT_CACHE_SECONDS : Number(match[1]);
  return (
    Math.min(Math.max(seconds, MIN_CACHE_SECONDS), MAX_CACHE_SECONDS) * 1000
  );
}

/**
 * Resolves Firebase signing certificates by key ID. Certificates are cached
 * according to the response's Cache-Control lifetime; an unknown key ID
 * triggers at most one forced refresh per minute to support key rotation
 * without allowing arbitrary refresh requests.
 */
export function createFirebaseKeyResolver(
  options: FirebaseKeyResolverOptions = {},
): FirebaseKeyResolver {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const importer =
    options.importer ?? ((pem: string) => importX509(pem, 'RS256'));

  let keys = new Map<string, CryptoKey>();
  let expiresAt = 0;
  let lastRefreshAt = 0;
  let refreshPromise: Promise<void> | undefined;

  async function refresh(): Promise<void> {
    const response = await fetcher(CERTIFICATE_URL, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(
        `Firebase certificate request failed with status ${response.status}`,
      );
    }
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) {
      throw new Error('Firebase certificate response was not an object');
    }

    const entries = Object.entries(body).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    const imported = await Promise.all(
      entries.map(
        async ([kid, pem]) => [kid, await importer(pem)] as const,
      ),
    );
    if (imported.length === 0) {
      throw new Error('Firebase certificate response contained no keys');
    }

    keys = new Map(imported);
    expiresAt = now() + cacheMaxAgeMs(response.headers.get('cache-control'));
    lastRefreshAt = now();
  }

  function startRefresh(): Promise<void> {
    if (refreshPromise === undefined) {
      const pending = refresh();
      refreshPromise = pending;
      const clear = () => {
        if (refreshPromise === pending) refreshPromise = undefined;
      };
      void pending.then(clear, clear);
    }
    return refreshPromise;
  }

  return {
    async getKey(kid: string): Promise<CryptoKey> {
      if (keys.size === 0 || now() >= expiresAt) {
        await startRefresh();
      }

      let key = keys.get(kid);
      if (
        key === undefined &&
        now() - lastRefreshAt >= FORCED_REFRESH_INTERVAL_MS
      ) {
        await startRefresh();
        key = keys.get(kid);
      }
      if (key === undefined) {
        throw new Error('Unknown Firebase signing key');
      }
      return key;
    },
  };
}

export interface VerifyIdTokenOptions {
  projectId: string;
  getKey: (kid: string) => Promise<CryptoKey>;
  now?: () => number;
}

export async function verifyFirebaseIdToken(
  token: string,
  options: VerifyIdTokenOptions,
): Promise<VerifiedFirebaseUser> {
  const { payload } = await jwtVerify(
    token,
    (header) => {
      const kid = header.kid;
      if (typeof kid !== 'string' || kid === '') {
        throw new Error('Firebase ID token is missing a key ID');
      }
      return options.getKey(kid);
    },
    {
      issuer: `https://securetoken.google.com/${options.projectId}`,
      audience: options.projectId,
      algorithms: ['RS256'],
      clockTolerance: 5,
      ...(options.now === undefined
        ? {}
        : { currentDate: new Date(options.now()) }),
    },
  );

  const uid = payload.sub;
  if (typeof uid !== 'string' || uid.trim() === '') {
    throw new Error('Firebase ID token is missing a subject');
  }
  if (typeof payload.auth_time !== 'number') {
    throw new Error('Firebase ID token is missing auth_time');
  }

  return {
    uid,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true,
  };
}
