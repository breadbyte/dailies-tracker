/**
 * Application-owned catalog schema.
 *
 * The bundled catalog is generated from Game Time Master (GPL-3.0-only).
 * These types describe the normalized artifact, not the upstream file shape.
 * See data/ATTRIBUTION.md for source provenance and license obligations.
 */

export const CATALOG_SCHEMA_VERSION = 1 as const;

/** Where the normalized catalog came from. */
export interface CatalogSource {
  /** Canonical repository URL. */
  repository: string;
  /** Full 40-character upstream commit SHA the data was read from. */
  commit: string;
  /** Path of the source file inside the repository. */
  path: string;
  /** SPDX license identifier of the upstream data. */
  license: string;
}

/**
 * How a daily reset time is anchored.
 *
 * - `local`: `time` is a wall-clock time in `timeZone`; it stays at the same
 *   local time across daylight-saving transitions.
 * - `utc`: `time` is a fixed UTC time; the server-local wall clock shifts
 *   across daylight-saving transitions.
 */
export type DailyResetBasis = 'local' | 'utc';

export interface DailyResetDefinition {
  /** `HH:mm` in 24-hour time. */
  time: string;
  basis: DailyResetBasis;
}

export interface GameServerDefinition {
  /** Globally unique, stable ID formatted as `<gameId>:<serverSlug>`. */
  id: string;
  /** Upstream server or region label (for example `Global`, `EN`, `Asia`). */
  name: string;
  /** IANA time zone name from the upstream data. */
  timeZone: string;
  /** Upstream icon identifier. No icon assets are bundled. */
  icon?: string;
  dailyReset: DailyResetDefinition;
}

export interface GameCatalogEntry {
  /** Stable ID derived from the upstream game name. */
  id: string;
  /** Display name. */
  name: string;
  /** Optional shorter menu label supplied upstream. */
  menuName?: string;
  servers: GameServerDefinition[];
}

export interface GameCatalog {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  source: CatalogSource;
  games: GameCatalogEntry[];
}

/** Non-deterministic sync details kept next to the deterministic catalog. */
export interface CatalogMetadata {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  catalogSchemaVersion: typeof CATALOG_SCHEMA_VERSION;
  source: CatalogSource;
  /** ISO timestamp of the sync run. */
  retrievedAt: string;
  /** ISO timestamp of the upstream commit, when known. */
  upstreamCommitDate?: string;
  counts: {
    games: number;
    servers: number;
  };
  catalog: {
    sha256: string;
    bytes: number;
  };
}

/** A record as it appears in the upstream `game-data.js` array. */
export interface UpstreamGameRecord {
  game: string;
  server: string;
  timezone: string;
  dailyReset: string;
  icon?: string;
  menuName?: string;
  utcDailyReset?: boolean;
}

export const UPSTREAM_REPOSITORY =
  'https://github.com/cicerakes/Game-Time-Master';
export const UPSTREAM_PATH = 'game-data.js';
export const UPSTREAM_LICENSE = 'GPL-3.0-only';
