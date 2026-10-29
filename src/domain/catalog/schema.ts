import {
  CATALOG_SCHEMA_VERSION,
  type CatalogMetadata,
  type CatalogSource,
  type DailyResetBasis,
  type GameCatalog,
  type GameCatalogEntry,
  type GameServerDefinition,
} from './types.ts';
import { isValidDailyResetTime, isValidTimeZone } from './validation.ts';

export class CatalogValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'CatalogValidationError';
    this.path = path;
  }
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SERVER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type UnknownRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new CatalogValidationError(path, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail(path, 'must be an object');
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string');
  if (value.trim() === '') fail(path, 'must not be empty');
  return value;
}

function asCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(path, 'must be a non-negative integer');
  }
  return value;
}

function asIsoTimestamp(value: unknown, path: string): string {
  const text = asString(value, path);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) fail(path, 'must be an ISO 8601 timestamp');
  return text;
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, 'is not a known field');
  }
}

function parseSource(value: unknown, path: string): CatalogSource {
  const source = asRecord(value, path);
  rejectUnknownKeys(source, ['repository', 'commit', 'path', 'license'], path);
  const repository = asString(source.repository, `${path}.repository`);
  if (!repository.startsWith('https://')) {
    fail(`${path}.repository`, 'must be an https URL');
  }
  const commit = asString(source.commit, `${path}.commit`);
  if (!COMMIT_PATTERN.test(commit)) {
    fail(`${path}.commit`, 'must be a 40-character lowercase commit SHA');
  }
  return {
    repository,
    commit,
    path: asString(source.path, `${path}.path`),
    license: asString(source.license, `${path}.license`),
  };
}

function parseServer(
  value: unknown,
  path: string,
  gameId: string,
): GameServerDefinition {
  const server = asRecord(value, path);
  rejectUnknownKeys(
    server,
    ['id', 'name', 'timeZone', 'icon', 'dailyReset'],
    path,
  );

  const id = asString(server.id, `${path}.id`);
  const prefix = `${gameId}:`;
  if (!id.startsWith(prefix)) {
    fail(`${path}.id`, `must start with \`${prefix}\``);
  }
  const slug = id.slice(prefix.length);
  if (!SERVER_SLUG_PATTERN.test(slug)) {
    fail(`${path}.id`, 'must end with a lowercase slug');
  }

  const timeZone = asString(server.timeZone, `${path}.timeZone`);
  if (!isValidTimeZone(timeZone)) {
    fail(`${path}.timeZone`, `is not a valid IANA time zone: \`${timeZone}\``);
  }

  const reset = asRecord(server.dailyReset, `${path}.dailyReset`);
  rejectUnknownKeys(reset, ['time', 'basis'], `${path}.dailyReset`);
  const time = asString(reset.time, `${path}.dailyReset.time`);
  if (!isValidDailyResetTime(time)) {
    fail(`${path}.dailyReset.time`, 'must be a valid HH:mm time');
  }
  const basisValue = asString(reset.basis, `${path}.dailyReset.basis`);
  if (basisValue !== 'local' && basisValue !== 'utc') {
    fail(`${path}.dailyReset.basis`, 'must be `local` or `utc`');
  }
  const basis: DailyResetBasis = basisValue;

  return {
    id,
    name: asString(server.name, `${path}.name`),
    timeZone,
    ...(server.icon === undefined
      ? {}
      : { icon: asString(server.icon, `${path}.icon`) }),
    dailyReset: { time, basis },
  };
}

function parseGame(
  value: unknown,
  path: string,
  seenGameIds: Set<string>,
  seenServerIds: Set<string>,
): GameCatalogEntry {
  const game = asRecord(value, path);
  rejectUnknownKeys(game, ['id', 'name', 'menuName', 'servers'], path);

  const id = asString(game.id, `${path}.id`);
  if (!GAME_ID_PATTERN.test(id)) {
    fail(`${path}.id`, 'must be a lowercase slug');
  }
  if (seenGameIds.has(id)) fail(`${path}.id`, `duplicate game ID \`${id}\``);
  seenGameIds.add(id);

  const servers = asArray(game.servers, `${path}.servers`);
  if (servers.length === 0) fail(`${path}.servers`, 'must not be empty');

  const parsedServers = servers.map((server, index) => {
    const parsed = parseServer(server, `${path}.servers[${index}]`, id);
    if (seenServerIds.has(parsed.id)) {
      fail(`${path}.servers[${index}].id`, `duplicate server ID \`${parsed.id}\``);
    }
    seenServerIds.add(parsed.id);
    return parsed;
  });

  return {
    id,
    name: asString(game.name, `${path}.name`),
    ...(game.menuName === undefined
      ? {}
      : { menuName: asString(game.menuName, `${path}.menuName`) }),
    servers: parsedServers,
  };
}

/** Validates and returns a deeply copied, typed catalog. */
export function parseGameCatalog(value: unknown): GameCatalog {
  const catalog = asRecord(value, 'catalog');
  rejectUnknownKeys(catalog, ['schemaVersion', 'source', 'games'], 'catalog');

  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    fail(
      'catalog.schemaVersion',
      `unsupported catalog schema; expected ${CATALOG_SCHEMA_VERSION}`,
    );
  }

  const games = asArray(catalog.games, 'catalog.games');
  if (games.length === 0) fail('catalog.games', 'must not be empty');

  const seenGameIds = new Set<string>();
  const seenServerIds = new Set<string>();
  const parsedGames = games.map((game, index) =>
    parseGame(game, `catalog.games[${index}]`, seenGameIds, seenServerIds),
  );

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    source: parseSource(catalog.source, 'catalog.source'),
    games: parsedGames,
  };
}

export function parseCatalogMetadata(value: unknown): CatalogMetadata {
  const metadata = asRecord(value, 'metadata');
  rejectUnknownKeys(
    metadata,
    [
      'schemaVersion',
      'catalogSchemaVersion',
      'source',
      'retrievedAt',
      'upstreamCommitDate',
      'counts',
      'catalog',
    ],
    'metadata',
  );

  if (metadata.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    fail('metadata.schemaVersion', 'unsupported metadata schema');
  }
  if (metadata.catalogSchemaVersion !== CATALOG_SCHEMA_VERSION) {
    fail('metadata.catalogSchemaVersion', 'unsupported catalog schema');
  }

  const counts = asRecord(metadata.counts, 'metadata.counts');
  rejectUnknownKeys(counts, ['games', 'servers'], 'metadata.counts');

  const catalog = asRecord(metadata.catalog, 'metadata.catalog');
  rejectUnknownKeys(catalog, ['sha256', 'bytes'], 'metadata.catalog');

  const sha256 = asString(catalog.sha256, 'metadata.catalog.sha256');
  if (!SHA256_PATTERN.test(sha256)) {
    fail('metadata.catalog.sha256', 'must be a lowercase SHA-256 hex digest');
  }
  const bytes = asCount(catalog.bytes, 'metadata.catalog.bytes');
  if (bytes === 0) fail('metadata.catalog.bytes', 'must be greater than zero');

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    source: parseSource(metadata.source, 'metadata.source'),
    retrievedAt: asIsoTimestamp(metadata.retrievedAt, 'metadata.retrievedAt'),
    ...(metadata.upstreamCommitDate === undefined
      ? {}
      : {
          upstreamCommitDate: asIsoTimestamp(
            metadata.upstreamCommitDate,
            'metadata.upstreamCommitDate',
          ),
        }),
    counts: {
      games: asCount(counts.games, 'metadata.counts.games'),
      servers: asCount(counts.servers, 'metadata.counts.servers'),
    },
    catalog: { sha256, bytes },
  };
}

export function countCatalog(catalog: GameCatalog): {
  games: number;
  servers: number;
} {
  return {
    games: catalog.games.length,
    servers: catalog.games.reduce(
      (total, game) => total + game.servers.length,
      0,
    ),
  };
}

export function assertMetadataMatchesCatalog(
  metadata: CatalogMetadata,
  catalog: GameCatalog,
): void {
  if (
    metadata.source.repository !== catalog.source.repository ||
    metadata.source.commit !== catalog.source.commit ||
    metadata.source.path !== catalog.source.path ||
    metadata.source.license !== catalog.source.license
  ) {
    throw new CatalogValidationError(
      'metadata.source',
      'does not match the catalog source',
    );
  }
  const counts = countCatalog(catalog);
  if (
    metadata.counts.games !== counts.games ||
    metadata.counts.servers !== counts.servers
  ) {
    throw new CatalogValidationError(
      'metadata.counts',
      'does not match the catalog contents',
    );
  }
}
