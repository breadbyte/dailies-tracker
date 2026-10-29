import {
  CATALOG_SCHEMA_VERSION,
  type CatalogSource,
  type DailyResetBasis,
  type GameCatalog,
  type GameCatalogEntry,
  type GameServerDefinition,
  type UpstreamGameRecord,
} from './types.ts';
import {
  isValidTimeZone,
  normalizeDailyResetTime,
  slugify,
} from './validation.ts';

export class CatalogNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogNormalizationError';
  }
}

interface MutableGame {
  id: string;
  name: string;
  menuName?: string;
  servers: Map<string, GameServerDefinition>;
}

/**
 * Converts parsed upstream records into the internal catalog.
 *
 * - Game and server identities are stable slugs derived from upstream names.
 * - `utcDailyReset: true` becomes `dailyReset.basis: 'utc'`; all other records
 *   use `'local'`, which preserves their wall-clock time across DST changes.
 * - Output ordering is deterministic: games and servers sort by ID.
 */
export function normalizeCatalog(
  records: readonly UpstreamGameRecord[],
  source: CatalogSource,
): GameCatalog {
  if (records.length === 0) {
    throw new CatalogNormalizationError(
      'Cannot normalize an empty upstream catalog',
    );
  }

  const games = new Map<string, MutableGame>();

  records.forEach((record, index) => {
    const label = `record ${index} (${record.game} / ${record.server})`;
    const dailyResetTime = normalizeDailyResetTime(record.dailyReset);
    if (dailyResetTime === undefined) {
      throw new CatalogNormalizationError(
        `${label} has invalid daily reset time \`${record.dailyReset}\`; expected HH:mm`,
      );
    }
    if (!isValidTimeZone(record.timezone)) {
      throw new CatalogNormalizationError(
        `${label} has invalid IANA time zone \`${record.timezone}\``,
      );
    }

    const gameId = slugify(record.game);
    if (gameId === '') {
      throw new CatalogNormalizationError(
        `${label} game name does not produce a usable ID`,
      );
    }
    const serverSlug = slugify(record.server);
    if (serverSlug === '') {
      throw new CatalogNormalizationError(
        `${label} server name does not produce a usable ID`,
      );
    }

    let game = games.get(gameId);
    if (game === undefined) {
      game = {
        id: gameId,
        name: record.game,
        ...(record.menuName === undefined
          ? {}
          : { menuName: record.menuName }),
        servers: new Map(),
      };
      games.set(gameId, game);
    } else {
      if (game.name !== record.game) {
        throw new CatalogNormalizationError(
          `Slug collision: \`${game.name}\` and \`${record.game}\` both map to \`${gameId}\``,
        );
      }
      if (
        record.menuName !== undefined &&
        game.menuName !== undefined &&
        game.menuName !== record.menuName
      ) {
        throw new CatalogNormalizationError(
          `Conflicting menuName values for \`${record.game}\`: \`${game.menuName}\` and \`${record.menuName}\``,
        );
      }
      if (record.menuName !== undefined) game.menuName = record.menuName;
    }

    const serverId = `${gameId}:${serverSlug}`;
    if (game.servers.has(serverId)) {
      throw new CatalogNormalizationError(
        `Duplicate server identity \`${serverId}\` in upstream data`,
      );
    }

    const basis: DailyResetBasis =
      record.utcDailyReset === true ? 'utc' : 'local';
    game.servers.set(serverId, {
      id: serverId,
      name: record.server,
      timeZone: record.timezone,
      ...(record.icon === undefined ? {} : { icon: record.icon }),
      dailyReset: { time: dailyResetTime, basis },
    });
  });

  const normalized: GameCatalogEntry[] = [...games.values()]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((game) => ({
      id: game.id,
      name: game.name,
      ...(game.menuName === undefined ? {} : { menuName: game.menuName }),
      servers: [...game.servers.values()].sort((a, b) =>
        compareIds(a.id, b.id),
      ),
    }));

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    source,
    games: normalized,
  };
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Serializes a catalog to deterministic, review-friendly JSON bytes. */
export function serializeCatalog(catalog: GameCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
