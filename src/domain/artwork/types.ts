/** Optional artwork metadata. Artwork is never required for the app to work. */

export type ArtworkSource = 'none' | 'steamgriddb';

export interface ArtworkImage {
  id: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  /** SteamGridDB's rating score; the highest score is treated as top-rated. */
  score: number;
}

export interface ArtworkMatch {
  id: number;
  name: string;
}

export interface ArtworkLookup {
  match: ArtworkMatch | null;
  images: ArtworkImage[];
}

export type ArtworkCacheStatus = 'ok' | 'no-match' | 'error';

export interface ArtworkCacheEntry {
  key: string;
  fetchedAt: string;
  status: ArtworkCacheStatus;
  match: ArtworkMatch | null;
  images: ArtworkImage[];
}

/**
 * Picks the image to display. A saved per-game choice wins when it is still
 * available; otherwise the highest SteamGridDB score is used. Equal scores keep
 * the API's returned order, so the default is deterministic without assuming
 * the first result is highest-rated.
 */
export function selectArtworkImage(
  images: readonly ArtworkImage[],
  preferredId?: number,
): ArtworkImage | undefined {
  if (preferredId !== undefined) {
    const preferred = images.find((image) => image.id === preferredId);
    if (preferred !== undefined) return preferred;
  }

  let best: ArtworkImage | undefined;
  for (const image of images) {
    if (best === undefined || image.score > best.score) best = image;
  }
  return best;
}
