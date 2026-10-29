import { describe, expect, it } from 'vitest';
import {
  CatalogNormalizationError,
  normalizeCatalog,
  serializeCatalog,
} from '../../../src/domain/catalog/normalize.ts';
import type {
  CatalogSource,
  UpstreamGameRecord,
} from '../../../src/domain/catalog/types.ts';

const SOURCE: CatalogSource = {
  repository: 'https://github.com/cicerakes/Game-Time-Master',
  commit: '0123456789abcdef0123456789abcdef01234567',
  path: 'game-data.js',
  license: 'GPL-3.0-only',
};

function record(
  overrides: Partial<UpstreamGameRecord> & Pick<UpstreamGameRecord, 'game' | 'server'>,
): UpstreamGameRecord {
  return {
    timezone: 'Etc/UTC',
    dailyReset: '04:00',
    ...overrides,
  };
}

describe('normalizeCatalog', () => {
  it('groups servers under games and derives stable IDs', () => {
    const catalog = normalizeCatalog(
      [
        record({ game: 'Alpha Game', server: 'Global', icon: 'alpha' }),
        record({
          game: 'Alpha Game',
          server: 'Asia',
          timezone: 'Asia/Tokyo',
          dailyReset: '4:00',
          icon: 'alpha-asia',
          menuName: 'Alpha',
        }),
        record({ game: 'Beta & Co', server: 'JP', icon: 'beta' }),
      ],
      SOURCE,
    );

    expect(catalog.games.map((game) => game.id)).toEqual([
      'alpha-game',
      'beta-and-co',
    ]);
    const alpha = catalog.games[0];
    expect(alpha?.name).toBe('Alpha Game');
    expect(alpha?.menuName).toBe('Alpha');
    expect(alpha?.servers.map((server) => server.id)).toEqual([
      'alpha-game:asia',
      'alpha-game:global',
    ]);
    // Per-server icons are preserved rather than collapsed to one game icon.
    expect(alpha?.servers.map((server) => server.icon)).toEqual([
      'alpha-asia',
      'alpha',
    ]);
  });

  it('pads unpadded reset times without changing the time', () => {
    const catalog = normalizeCatalog(
      [record({ game: 'A', server: 'S', dailyReset: '4:05' })],
      SOURCE,
    );
    expect(catalog.games[0]?.servers[0]?.dailyReset.time).toBe('04:05');
  });

  it('maps utcDailyReset to basis "utc" and everything else to "local"', () => {
    const catalog = normalizeCatalog(
      [
        record({ game: 'A', server: 'S' }),
        record({ game: 'A', server: 'T', utcDailyReset: true }),
        record({ game: 'A', server: 'U', utcDailyReset: false }),
      ],
      SOURCE,
    );
    const bases = catalog.games[0]?.servers.map(
      (server) => server.dailyReset.basis,
    );
    expect(bases).toEqual(['local', 'utc', 'local']);
  });

  it('rejects invalid times, time zones, and empty names', () => {
    expect(() =>
      normalizeCatalog([record({ game: 'A', server: 'S', dailyReset: '24:00' })], SOURCE),
    ).toThrow(/invalid daily reset time/);
    expect(() =>
      normalizeCatalog(
        [record({ game: 'A', server: 'S', timezone: 'Not/AZone' })],
        SOURCE,
      ),
    ).toThrow(/invalid IANA time zone/);
    expect(() =>
      normalizeCatalog([record({ game: '!!!', server: 'S' })], SOURCE),
    ).toThrow(/does not produce a usable ID/);
  });

  it('rejects duplicate server identities and empty catalogs', () => {
    expect(() =>
      normalizeCatalog(
        [
          record({ game: 'A', server: 'S' }),
          record({ game: 'A', server: 'S' }),
        ],
        SOURCE,
      ),
    ).toThrow(/Duplicate server identity/);
    expect(() => normalizeCatalog([], SOURCE)).toThrow(
      CatalogNormalizationError,
    );
  });

  it('rejects slug collisions between different display names', () => {
    expect(() =>
      normalizeCatalog(
        [
          record({ game: 'A B', server: 'S' }),
          record({ game: 'A-B', server: 'T' }),
        ],
        SOURCE,
      ),
    ).toThrow(/Slug collision/);
  });

  it('rejects conflicting menu names for one game', () => {
    expect(() =>
      normalizeCatalog(
        [
          record({ game: 'A', server: 'S', menuName: 'One' }),
          record({ game: 'A', server: 'T', menuName: 'Two' }),
        ],
        SOURCE,
      ),
    ).toThrow(/Conflicting menuName/);
  });

  it('serializes deterministically regardless of input order', () => {
    const records = [
      record({ game: 'B', server: 'S' }),
      record({ game: 'A', server: 'T' }),
      record({ game: 'A', server: 'S' }),
    ];
    const first = serializeCatalog(normalizeCatalog(records, SOURCE));
    const second = serializeCatalog(
      normalizeCatalog([...records].reverse(), SOURCE),
    );
    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
  });
});
