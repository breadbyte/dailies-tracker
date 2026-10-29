import catalogText from '../../../data/game-catalog.json?raw';
import { parseGameCatalog } from '../../domain/catalog/schema.ts';
import type { GameCatalog } from '../../domain/catalog/types.ts';

let cached: GameCatalog | undefined;

/**
 * Loads the catalog bundled into the application build.
 *
 * The JSON is imported as text, so it is available offline and in tests
 * without a network request. Validation runs on first use and the parsed
 * result is cached for the lifetime of the page.
 */
export function loadBundledGameCatalog(): GameCatalog {
  if (cached === undefined) {
    cached = parseGameCatalog(JSON.parse(catalogText));
  }
  return cached;
}

/** Test hook: clears the memoized catalog. */
export function resetBundledGameCatalogCache(): void {
  cached = undefined;
}
