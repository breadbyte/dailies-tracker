import { appConfig } from '../../config/env.ts';
import { parseArtworkLookup } from '../../domain/artwork/validation.ts';
import type {
  ArtworkCacheEntry,
  ArtworkLookup,
} from '../../domain/artwork/types.ts';
import {
  readArtworkCacheEntry,
  writeArtworkCacheEntry,
} from '../storage/artworkCache.ts';

const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_CAP_MS = 30_000;

export interface ArtworkCache {
  read(key: string): Promise<ArtworkCacheEntry | undefined>;
  write(entry: ArtworkCacheEntry): Promise<void>;
}

export interface ArtworkClient {
  lookup(gameName: string): Promise<ArtworkLookup | null>;
}

export interface ArtworkClientOptions {
  fetcher?: typeof fetch;
  cache?: ArtworkCache;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  minIntervalMs?: number;
  proxyBaseUrl?: string;
}

const indexedDbCache: ArtworkCache = {
  read: readArtworkCacheEntry,
  write: writeArtworkCacheEntry,
};

export function normalizeGameName(gameName: string): string {
  return gameName.trim().toLocaleLowerCase();
}

function cacheTtlMs(status: ArtworkCacheEntry['status']): number {
  if (status === 'ok') return SUCCESS_TTL_MS;
  if (status === 'no-match') return NEGATIVE_TTL_MS;
  return ERROR_TTL_MS;
}

function isFresh(entry: ArtworkCacheEntry, nowMs: number): boolean {
  const fetchedAt = Date.parse(entry.fetchedAt);
  return (
    Number.isFinite(fetchedAt) && nowMs - fetchedAt < cacheTtlMs(entry.status)
  );
}

function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - nowMs, 0), RETRY_AFTER_CAP_MS);
  }
  return undefined;
}

function backoffMs(
  attempt: number,
  random: () => number,
  retryAfter: number | undefined,
): number {
  if (retryAfter !== undefined) return retryAfter;
  return Math.min(250 * 2 ** attempt + random() * 100, 5000);
}

function lookupFromEntry(entry: ArtworkCacheEntry): ArtworkLookup | null {
  if (entry.status === 'no-match') return { match: null, images: [] };
  if (entry.status !== 'ok') return null;
  return { match: entry.match, images: entry.images };
}

function entryFromLookup(
  key: string,
  fetchedAt: string,
  lookup: ArtworkLookup,
): ArtworkCacheEntry {
  return {
    key,
    fetchedAt,
    status: lookup.match === null ? 'no-match' : 'ok',
    match: lookup.match,
    images: lookup.images,
  };
}

/**
 * Creates a lazily fetched, locally cached SteamGridDB client.
 *
 * Requests are serialized with a conservative minimum interval, deduplicated
 * per game, and retried a bounded number of times with exponential backoff and
 * jitter. `Retry-After` is honored when the proxy forwards it. Failures degrade
 * to `null` so cards keep their neutral fallback.
 */
export function createArtworkClient(
  options: ArtworkClientOptions = {},
): ArtworkClient {
  const fetcher = options.fetcher ?? fetch;
  const cache = options.cache ?? indexedDbCache;
  const now = options.now ?? (() => new Date());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
  const proxyBaseUrl = (
    options.proxyBaseUrl ??
    appConfig.apiBaseUrl ??
    ''
  ).replace(/\/+$/, '');

  const inFlight = new Map<string, Promise<ArtworkLookup | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minIntervalMs - now().getTime();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now().getTime();
      return task();
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function request(gameName: string): Promise<ArtworkLookup> {
    const url = `${proxyBaseUrl}/api/v1/artwork?name=${encodeURIComponent(gameName)}`;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { accept: 'application/json' },
          referrerPolicy: 'no-referrer',
        });
      } catch (error) {
        lastError = error;
        if (attempt + 1 < MAX_ATTEMPTS) {
          await sleep(backoffMs(attempt, random, undefined));
          continue;
        }
        break;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(
          `Artwork request failed with status ${response.status}`,
        );
        if (attempt + 1 < MAX_ATTEMPTS) {
          const retryAfter = retryAfterMs(
            response.headers.get('retry-after'),
            now().getTime(),
          );
          await sleep(backoffMs(attempt, random, retryAfter));
          continue;
        }
        break;
      }

      if (!response.ok) {
        throw new Error(
          `Artwork request failed with status ${response.status}`,
        );
      }

      return parseArtworkLookup(await response.json());
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Artwork request failed');
  }

  async function fetchAndCache(
    key: string,
    gameName: string,
  ): Promise<ArtworkLookup | null> {
    try {
      const lookup = await enqueue(() => request(gameName));
      const entry = entryFromLookup(key, now().toISOString(), lookup);
      try {
        await cache.write(entry);
      } catch {
        // A cache failure must not hide otherwise usable artwork.
      }
      return lookup;
    } catch {
      const entry: ArtworkCacheEntry = {
        key,
        fetchedAt: now().toISOString(),
        status: 'error',
        match: null,
        images: [],
      };
      try {
        await cache.write(entry);
      } catch {
        // Ignore cache failures.
      }
      return null;
    }
  }

  return {
    async lookup(gameName: string): Promise<ArtworkLookup | null> {
      const key = normalizeGameName(gameName);
      if (key === '') return null;

      const cached = await cache.read(key).catch(() => undefined);
      if (cached !== undefined && isFresh(cached, now().getTime())) {
        return lookupFromEntry(cached);
      }

      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;

      const pending = fetchAndCache(key, gameName.trim()).finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
      inFlight.set(key, pending);
      return pending;
    },
  };
}

/** App-wide client; its in-memory dedupe state is shared by every card. */
export const artworkClient = createArtworkClient();
