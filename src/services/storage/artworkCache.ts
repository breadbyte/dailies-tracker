import { parseArtworkCacheEntry } from '../../domain/artwork/validation.ts';
import type { ArtworkCacheEntry } from '../../domain/artwork/types.ts';
import { STORE_NAMES } from './database.ts';
import { putRecord, readRecord } from './records.ts';

/**
 * Artwork cache records are local, best-effort data. A corrupt record is
 * treated as a cache miss rather than failing the page.
 */
export async function readArtworkCacheEntry(
  key: string,
): Promise<ArtworkCacheEntry | undefined> {
  const record = await readRecord(STORE_NAMES.artworkCache, key);
  if (record === undefined) return undefined;
  try {
    return parseArtworkCacheEntry(record);
  } catch {
    return undefined;
  }
}

export async function writeArtworkCacheEntry(
  entry: ArtworkCacheEntry,
): Promise<void> {
  await putRecord(STORE_NAMES.artworkCache, entry);
}
