import type { Env } from './env.ts';
import {
  createFirebaseKeyResolver,
  verifyFirebaseIdToken,
  type FirebaseKeyResolver,
  type VerifiedFirebaseUser,
} from './auth.ts';

const API_VERSION = 'v1';
const HEALTH_PATH = `/api/${API_VERSION}/health`;
const ACCOUNT_PATH = `/api/${API_VERSION}/account`;
const ARTWORK_PATH = `/api/${API_VERSION}/artwork`;
const MAX_TOKEN_LENGTH = 8192;
const MAX_ARTWORK_NAME_LENGTH = 120;
const MAX_ARTWORK_IMAGES = 24;
const ARTWORK_CACHE_SECONDS = 3600;

const STEAMGRIDDB_API = 'https://www.steamgriddb.com/api/v2';

interface ArtworkMatch {
  id: number;
  name: string;
}

interface ArtworkImage {
  id: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  score: number;
}

interface ArtworkPayload {
  match: ArtworkMatch | null;
  images: ArtworkImage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeArtworkName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function readArtworkName(url: URL): string | null {
  const name = (url.searchParams.get('name') ?? '').trim();
  if (name === '' || name.length > MAX_ARTWORK_NAME_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function parseGames(value: unknown): ArtworkMatch[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  const games: ArtworkMatch[] = [];
  for (const item of value.data) {
    if (!isRecord(item)) continue;
    if (!isPositiveInteger(item.id) || typeof item.name !== 'string') continue;
    const name = item.name.trim();
    if (name === '' || name.length > 160) continue;
    games.push({ id: item.id, name });
  }
  return games;
}

function parseImages(value: unknown): ArtworkImage[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  const images: ArtworkImage[] = [];
  for (const item of value.data) {
    if (!isRecord(item)) continue;
    if (item.nsfw === true || item.humor === true || item.epilepsy === true) {
      continue;
    }
    if (
      !isPositiveInteger(item.id) ||
      !isHttpsUrl(item.url) ||
      !isHttpsUrl(item.thumb) ||
      !isPositiveInteger(item.width) ||
      !isPositiveInteger(item.height) ||
      typeof item.score !== 'number' ||
      !Number.isFinite(item.score)
    ) {
      continue;
    }
    images.push({
      id: item.id,
      url: item.url,
      thumb: item.thumb,
      width: item.width,
      height: item.height,
      score: item.score,
    });
  }
  return images
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_ARTWORK_IMAGES);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function artworkCacheKey(name: string): Request {
  return new Request(
    `https://artwork-cache.internal/v1/${encodeURIComponent(normalizeArtworkName(name))}`,
  );
}

async function readCachedArtwork(name: string): Promise<ArtworkPayload | null> {
  if (typeof caches === 'undefined' || caches.default === undefined) {
    return null;
  }
  try {
    const cached = await caches.default.match(artworkCacheKey(name));
    if (cached === undefined) return null;
    const body = await readJson(cached);
    if (!isRecord(body)) return null;
    return {
      match: parseArtworkMatch(body.match),
      images: parseImages({ data: body.images }),
    };
  } catch {
    return null;
  }
}

function parseArtworkMatch(value: unknown): ArtworkMatch | null {
  if (!isRecord(value)) return null;
  if (!isPositiveInteger(value.id) || typeof value.name !== 'string') {
    return null;
  }
  return { id: value.id, name: value.name };
}

async function writeCachedArtwork(
  name: string,
  payload: ArtworkPayload,
): Promise<void> {
  if (typeof caches === 'undefined' || caches.default === undefined) return;
  try {
    await caches.default.put(
      artworkCacheKey(name),
      new Response(JSON.stringify(payload), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${ARTWORK_CACHE_SECONDS}`,
        },
      }),
    );
  } catch {
    // Cache writes are an optimization and must never fail the request.
  }
}

async function fetchArtwork(
  name: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<ArtworkPayload> {
  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json',
  };

  const searchResponse = await fetcher(
    `${STEAMGRIDDB_API}/search/autocomplete/${encodeURIComponent(name)}`,
    { headers },
  );
  if (!searchResponse.ok) {
    throw new UpstreamArtworkError(searchResponse.status, searchResponse);
  }
  const games = parseGames(await readJson(searchResponse));
  if (games.length === 0) return { match: null, images: [] };

  const normalized = normalizeArtworkName(name);
  const match =
    games.find((game) => normalizeArtworkName(game.name) === normalized) ??
    games[0];
  if (match === undefined) return { match: null, images: [] };

  const gridsResponse = await fetcher(
    `${STEAMGRIDDB_API}/grids/game/${match.id}?types=static&nsfw=false&humor=false&epilepsy=false`,
    { headers },
  );
  if (!gridsResponse.ok) {
    throw new UpstreamArtworkError(gridsResponse.status, gridsResponse);
  }

  return {
    match,
    images: parseImages(await readJson(gridsResponse)),
  };
}

class UpstreamArtworkError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, response: Response) {
    super(`SteamGridDB request failed with status ${status}`);
    this.name = 'UpstreamArtworkError';
    this.status = status;
    this.retryAfter = response.headers.get('retry-after');
  }
}

type JsonHeaders = Record<string, string>;

function json(body: unknown, status: number, headers: JsonHeaders = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      vary: 'Origin',
      ...headers,
    },
  });
}

function readAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/**
 * Returns CORS headers for an allowed browser origin, an empty object for
 * non-browser requests without an Origin header, or null when the origin is
 * not allowed.
 */
function corsHeaders(
  request: Request,
  env: Env,
): JsonHeaders | null {
  const origin = request.headers.get('origin');
  if (origin === null) return {};
  if (!readAllowedOrigins(env).includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'Authorization',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '600',
  };
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

function unauthorized(headers: JsonHeaders): Response {
  return json(
    { error: 'unauthorized' },
    401,
    { ...headers, 'www-authenticate': 'Bearer' },
  );
}

export type VerifyIdToken = (
  token: string,
  projectId: string,
) => Promise<VerifiedFirebaseUser>;

export interface WorkerOptions {
  /** Injectable for tests; production uses verified Firebase ID tokens. */
  verifyIdToken?: VerifyIdToken;
  /** Injectable for tests; production calls SteamGridDB directly. */
  steamGridDbFetch?: typeof fetch;
}

export interface Worker {
  fetch(request: Request, env: Env): Promise<Response>;
}

let firebaseKeys: FirebaseKeyResolver | undefined;

function verifyWithFirebase(
  token: string,
  projectId: string,
): Promise<VerifiedFirebaseUser> {
  const keys = (firebaseKeys ??= createFirebaseKeyResolver());
  return verifyFirebaseIdToken(token, {
    projectId,
    getKey: (kid) => keys.getKey(kid),
  });
}

/**
 * Optional backend for cloud features. The default device-only mode never
 * calls this Worker. The account endpoint returns only the identity proven by
 * a verified Firebase ID token; no account data is stored or synchronized.
 */
export function createWorker(
  options: WorkerOptions = {},
): Worker {
  const verifyIdToken = options.verifyIdToken ?? verifyWithFirebase;
  const steamGridDbFetch = options.steamGridDbFetch ?? fetch;

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const { pathname } = new URL(request.url);
      const cors = corsHeaders(request, env);
      if (cors === null) {
        return json({ error: 'origin_not_allowed' }, 403);
      }

      if (request.method === 'OPTIONS') {
        if (
          pathname !== HEALTH_PATH &&
          pathname !== ACCOUNT_PATH &&
          pathname !== ARTWORK_PATH
        ) {
          return json({ error: 'not_found' }, 404, cors);
        }
        return new Response(null, {
          status: 204,
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            vary: 'Origin',
            ...cors,
          },
        });
      }

      if (pathname === ARTWORK_PATH) {
        if (request.method !== 'GET') {
          return json({ error: 'method_not_allowed' }, 405, cors);
        }

        const name = readArtworkName(new URL(request.url));
        if (name === null) {
          return json({ error: 'invalid_name' }, 400, cors);
        }

        const apiKey = (env.STEAMGRIDDB_API_KEY ?? '').trim();
        if (apiKey === '') {
          return json({ error: 'artwork_not_configured' }, 503, cors);
        }

        const cached = await readCachedArtwork(name);
        if (cached !== null) {
          return json(cached, 200, {
            ...cors,
            'cache-control': `private, max-age=${ARTWORK_CACHE_SECONDS}`,
          });
        }

        try {
          const payload = await fetchArtwork(name, apiKey, steamGridDbFetch);
          await writeCachedArtwork(name, payload);
          return json(payload, 200, {
            ...cors,
            'cache-control': `private, max-age=${ARTWORK_CACHE_SECONDS}`,
          });
        } catch (error) {
          if (error instanceof UpstreamArtworkError) {
            const headers: JsonHeaders = { ...cors };
            if (error.retryAfter !== null) {
              headers['retry-after'] = error.retryAfter;
            }
            return json(
              { error: 'upstream_unavailable' },
              error.status === 429 ? 429 : 502,
              headers,
            );
          }
          return json({ error: 'upstream_unavailable' }, 502, cors);
        }
      }

      if (pathname === HEALTH_PATH) {
        if (request.method !== 'GET') {
          return json({ error: 'method_not_allowed' }, 405, cors);
        }
        return json({ status: 'ok' }, 200, cors);
      }

      if (pathname === ACCOUNT_PATH) {
        if (request.method !== 'GET') {
          return json({ error: 'method_not_allowed' }, 405, cors);
        }

        const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim();
        if (projectId === '') {
          return json({ error: 'auth_not_configured' }, 503, cors);
        }

        const token = readBearerToken(request);
        if (token === null) return unauthorized(cors);

        try {
          const user = await verifyIdToken(token, projectId);
          return json(user, 200, cors);
        } catch {
          return unauthorized(cors);
        }
      }

      return json({ error: 'not_found' }, 404, cors);
    },
  };
}

export default createWorker();
