import type {
  ArtworkCacheEntry,
  ArtworkCacheStatus,
  ArtworkImage,
  ArtworkLookup,
  ArtworkMatch,
} from './types.ts';

const MAX_NAME_LENGTH = 160;
const MAX_IMAGES = 50;
const MAX_URL_LENGTH = 2000;

type UnknownRecord = Record<string, unknown>;

export class ArtworkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtworkValidationError';
  }
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtworkValidationError(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function asText(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ArtworkValidationError(`${path} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new ArtworkValidationError(`${path} is too long`);
  }
  return value;
}

function asFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ArtworkValidationError(`${path} must be a number`);
  }
  return value;
}

function asPositiveInteger(value: unknown, path: string): number {
  const parsed = asFiniteNumber(value, path);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ArtworkValidationError(`${path} must be a positive integer`);
  }
  return parsed;
}

function asHttpsUrl(value: unknown, path: string): string {
  const text = asText(value, path, MAX_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ArtworkValidationError(`${path} must be a URL`);
  }
  if (url.protocol !== 'https:') {
    throw new ArtworkValidationError(`${path} must use HTTPS`);
  }
  return text;
}

function parseMatch(value: unknown): ArtworkMatch | null {
  if (value === null) return null;
  const match = asRecord(value, 'match');
  return {
    id: asPositiveInteger(match.id, 'match.id'),
    name: asText(match.name, 'match.name', MAX_NAME_LENGTH),
  };
}

function parseImage(value: unknown, index: number): ArtworkImage {
  const image = asRecord(value, `images[${index}]`);
  return {
    id: asPositiveInteger(image.id, `images[${index}].id`),
    url: asHttpsUrl(image.url, `images[${index}].url`),
    thumb: asHttpsUrl(image.thumb, `images[${index}].thumb`),
    width: asPositiveInteger(image.width, `images[${index}].width`),
    height: asPositiveInteger(image.height, `images[${index}].height`),
    score: asFiniteNumber(image.score, `images[${index}].score`),
  };
}

/** Validates the proxy response before using any image URL. */
export function parseArtworkLookup(value: unknown): ArtworkLookup {
  const lookup = asRecord(value, 'artwork');
  const match = parseMatch(lookup.match);
  if (!Array.isArray(lookup.images)) {
    throw new ArtworkValidationError('artwork.images must be an array');
  }
  if (lookup.images.length > MAX_IMAGES) {
    throw new ArtworkValidationError('artwork.images contains too many items');
  }
  const images = lookup.images.map(parseImage);
  if (match === null && images.length > 0) {
    throw new ArtworkValidationError(
      'artwork.images must be empty when no game matched',
    );
  }
  return { match, images };
}

const CACHE_STATUSES: readonly ArtworkCacheStatus[] = [
  'ok',
  'no-match',
  'error',
];

/** Validates a cached record; a malformed cache entry is treated as a miss. */
export function parseArtworkCacheEntry(value: unknown): ArtworkCacheEntry {
  const entry = asRecord(value, 'artworkCache');
  const key = asText(entry.key, 'artworkCache.key', 256);
  const fetchedAt = asText(entry.fetchedAt, 'artworkCache.fetchedAt', 40);
  const parsedAt = Date.parse(fetchedAt);
  if (!Number.isFinite(parsedAt) || new Date(parsedAt).toISOString() !== fetchedAt) {
    throw new ArtworkValidationError(
      'artworkCache.fetchedAt must be a canonical UTC ISO timestamp',
    );
  }

  const status = entry.status;
  if (
    typeof status !== 'string' ||
    !CACHE_STATUSES.includes(status as ArtworkCacheStatus)
  ) {
    throw new ArtworkValidationError('artworkCache.status is not supported');
  }

  const lookup = parseArtworkLookup({
    match: entry.match,
    images: entry.images,
  });
  if (status === 'ok' && lookup.match === null) {
    throw new ArtworkValidationError(
      'artworkCache.match is required for a successful lookup',
    );
  }
  if (status !== 'ok' && (lookup.match !== null || lookup.images.length > 0)) {
    throw new ArtworkValidationError(
      'artworkCache has artwork for a non-successful lookup',
    );
  }

  return {
    key,
    fetchedAt,
    status: status as ArtworkCacheStatus,
    match: lookup.match,
    images: lookup.images,
  };
}
