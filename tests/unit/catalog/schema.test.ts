import { describe, expect, it } from 'vitest';
import {
  assertMetadataMatchesCatalog,
  CatalogValidationError,
  countCatalog,
  parseCatalogMetadata,
  parseGameCatalog,
} from '../../../src/domain/catalog/schema.ts';
import { normalizeCatalog } from '../../../src/domain/catalog/normalize.ts';
import type {
  CatalogMetadata,
  CatalogSource,
  GameCatalog,
  UpstreamGameRecord,
} from '../../../src/domain/catalog/types.ts';

const SOURCE: CatalogSource = {
  repository: 'https://github.com/cicerakes/Game-Time-Master',
  commit: '0123456789abcdef0123456789abcdef01234567',
  path: 'game-data.js',
  license: 'GPL-3.0-only',
};

const RECORDS: UpstreamGameRecord[] = [
  {
    game: 'Alpha Game',
    server: 'Global',
    timezone: 'Etc/UTC',
    dailyReset: '04:00',
    icon: 'alpha',
  },
  {
    game: 'Beta Game',
    server: 'JP',
    timezone: 'Asia/Tokyo',
    dailyReset: '05:00',
    utcDailyReset: true,
  },
];

function validCatalog(): GameCatalog {
  return normalizeCatalog(RECORDS, SOURCE);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectInvalid(
  value: unknown,
  pattern: RegExp,
): void {
  expect(() => parseGameCatalog(value)).toThrow(CatalogValidationError);
  expect(() => parseGameCatalog(value)).toThrow(pattern);
}

describe('parseGameCatalog', () => {
  it('accepts and deeply copies a normalized catalog', () => {
    const catalog = validCatalog();
    const parsed = parseGameCatalog(JSON.parse(JSON.stringify(catalog)));
    expect(parsed).toEqual(catalog);
    expect(parsed).not.toBe(catalog);
    expect(countCatalog(parsed)).toEqual({ games: 2, servers: 2 });
  });

  it('rejects an unsupported schema version', () => {
    const catalog = clone(validCatalog()) as unknown as Record<string, unknown>;
    catalog.schemaVersion = 2;
    expectInvalid(catalog, /unsupported catalog schema/);
  });

  it('rejects invalid times, bases, and time zones', () => {
    const badTime = clone(validCatalog());
    badTime.games[0]!.servers[0]!.dailyReset.time = '4:00';
    expectInvalid(badTime, /valid HH:mm time/);

    const badBasis = clone(validCatalog()) as unknown as {
      games: { servers: { dailyReset: { basis: string } }[] }[];
    };
    badBasis.games[0]!.servers[0]!.dailyReset.basis = 'server';
    expectInvalid(badBasis, /must be `local` or `utc`/);

    const badZone = clone(validCatalog());
    badZone.games[0]!.servers[0]!.timeZone = 'Mars/Olympus';
    expectInvalid(badZone, /not a valid IANA time zone/);
  });

  it('rejects server IDs that do not belong to their game', () => {
    const catalog = clone(validCatalog());
    catalog.games[0]!.servers[0]!.id = 'other-game:global';
    expectInvalid(catalog, /must start with/);
  });

  it('rejects duplicate game and server IDs', () => {
    const duplicateGame = clone(validCatalog());
    duplicateGame.games[1]!.id = duplicateGame.games[0]!.id;
    expectInvalid(duplicateGame, /duplicate game ID/);

    const duplicateServer = clone(validCatalog());
    duplicateServer.games[1]!.servers[0]!.id =
      duplicateServer.games[0]!.servers[0]!.id;
    expectInvalid(duplicateServer, /must start with|duplicate server ID/);
  });

  it('rejects unknown fields and empty collections', () => {
    const extra = clone(validCatalog()) as unknown as Record<string, unknown>;
    extra.extra = true;
    expectInvalid(extra, /is not a known field/);

    const noGames = clone(validCatalog());
    noGames.games = [];
    expectInvalid(noGames, /must not be empty/);

    const noServers = clone(validCatalog());
    noServers.games[0]!.servers = [];
    expectInvalid(noServers, /must not be empty/);
  });

  it('rejects a malformed source commit', () => {
    const catalog = clone(validCatalog());
    catalog.source.commit = 'not-a-sha';
    expectInvalid(catalog, /40-character lowercase commit SHA/);
  });
});

describe('parseCatalogMetadata', () => {
  const metadata: CatalogMetadata = {
    schemaVersion: 1,
    catalogSchemaVersion: 1,
    source: SOURCE,
    retrievedAt: '2026-10-29T00:00:00.000Z',
    upstreamCommitDate: '2026-10-26T13:51:22Z',
    counts: { games: 2, servers: 2 },
    catalog: { sha256: 'a'.repeat(64), bytes: 100 },
  };

  it('accepts valid metadata', () => {
    expect(parseCatalogMetadata(clone(metadata))).toEqual(metadata);
  });

  it('rejects malformed hashes, counts, and timestamps', () => {
    expect(() =>
      parseCatalogMetadata({ ...clone(metadata), catalog: { sha256: 'abc', bytes: 1 } }),
    ).toThrow(/SHA-256/);
    expect(() =>
      parseCatalogMetadata({
        ...clone(metadata),
        counts: { games: -1, servers: 2 },
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      parseCatalogMetadata({
        ...clone(metadata),
        retrievedAt: 'yesterday',
      }),
    ).toThrow(/ISO 8601/);
  });

  it('checks metadata against catalog source and counts', () => {
    const catalog = validCatalog();
    expect(() => assertMetadataMatchesCatalog(metadata, catalog)).not.toThrow();

    expect(() =>
      assertMetadataMatchesCatalog(
        { ...clone(metadata), counts: { games: 1, servers: 2 } },
        catalog,
      ),
    ).toThrow(/counts/);
    expect(() =>
      assertMetadataMatchesCatalog(
        {
          ...clone(metadata),
          source: { ...SOURCE, commit: 'f'.repeat(40) },
        },
        catalog,
      ),
    ).toThrow(/source/);
  });
});
