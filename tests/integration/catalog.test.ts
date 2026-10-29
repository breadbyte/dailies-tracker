import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATALOG_FILENAME,
  METADATA_FILENAME,
  syncCatalog,
  validateCatalog,
} from '../../scripts/catalog-lib.ts';
import { CatalogValidationError } from '../../src/domain/catalog/schema.ts';
import {
  loadBundledGameCatalog,
  resetBundledGameCatalogCache,
} from '../../src/services/catalog/loadBundledCatalog.ts';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'tests/fixtures/game-data.sample.js');
const BUNDLED_DATA = path.join(ROOT, 'data');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const COMMIT_DATE = '2026-10-26T13:51:22Z';
const RETRIEVED_AT = '2026-10-29T00:00:00.000Z';

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dailies-catalog-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetBundledGameCatalogCache();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function syncFromFixture(dataDir: string) {
  return syncCatalog({
    dataDir,
    sourcePath: FIXTURE,
    commit: COMMIT,
    commitDate: COMMIT_DATE,
    retrievedAt: RETRIEVED_AT,
  });
}

describe('catalog synchronization', () => {
  it('writes validated catalog and metadata artifacts', async () => {
    const dataDir = await tempDataDir();
    const result = await syncFromFixture(dataDir);

    expect(result.changed).toBe(true);
    expect(result.catalog.source.commit).toBe(COMMIT);
    expect(result.catalog.games.map((game) => game.id)).toEqual([
      'alpha-game',
      'beta-and-co',
      'girls-frontline',
    ]);

    const beta = result.catalog.games.find((game) => game.id === 'beta-and-co');
    expect(beta?.servers[0]?.dailyReset).toEqual({
      time: '05:30',
      basis: 'utc',
    });

    const validated = await validateCatalog({ dataDir });
    expect(validated.catalog).toEqual(result.catalog);
    expect(validated.metadata.counts).toEqual({ games: 3, servers: 4 });
    expect(validated.metadata.catalog.bytes).toBe(
      Buffer.byteLength(JSON.stringify(validated.catalog, null, 2)) + 1,
    );
  });

  it('is reproducible for a fixed commit and source', async () => {
    const first = await tempDataDir();
    const second = await tempDataDir();
    await syncFromFixture(first);
    await syncFromFixture(second);

    const firstCatalog = await readFile(path.join(first, CATALOG_FILENAME));
    const secondCatalog = await readFile(path.join(second, CATALOG_FILENAME));
    expect(firstCatalog.equals(secondCatalog)).toBe(true);

    const firstMetadata = await readFile(path.join(first, METADATA_FILENAME));
    const secondMetadata = await readFile(path.join(second, METADATA_FILENAME));
    expect(firstMetadata.equals(secondMetadata)).toBe(true);
  });

  it('keeps the last known-good catalog when the upstream source is invalid', async () => {
    const dataDir = await tempDataDir();
    await syncFromFixture(dataDir);
    const catalogBefore = await readFile(path.join(dataDir, CATALOG_FILENAME));
    const metadataBefore = await readFile(
      path.join(dataDir, METADATA_FILENAME),
    );

    const badSource = path.join(dataDir, 'bad-game-data.js');
    await writeFile(
      badSource,
      'var gameData = [{ game: "A", server: "S", timezone: "Bad/Zone", dailyReset: "00:00" }];',
    );

    await expect(
      syncCatalog({
        dataDir,
        sourcePath: badSource,
        commit: COMMIT,
      }),
    ).rejects.toThrow(/invalid IANA time zone/);

    expect(
      (await readFile(path.join(dataDir, CATALOG_FILENAME))).equals(
        catalogBefore,
      ),
    ).toBe(true);
    expect(
      (await readFile(path.join(dataDir, METADATA_FILENAME))).equals(
        metadataBefore,
      ),
    ).toBe(true);
  });

  it('keeps existing artifacts when the network is unavailable', async () => {
    const dataDir = await tempDataDir();
    await syncFromFixture(dataDir);
    const before = await readFile(path.join(dataDir, CATALOG_FILENAME));

    const failingFetch = (async () => {
      throw new Error('network disabled');
    }) as typeof fetch;

    await expect(
      syncCatalog({ dataDir, fetchImpl: failingFetch }),
    ).rejects.toThrow(/network disabled/);

    expect(
      (await readFile(path.join(dataDir, CATALOG_FILENAME))).equals(before),
    ).toBe(true);
  });

  it('requires a commit SHA when reading a local source', async () => {
    const dataDir = await tempDataDir();
    await expect(
      syncCatalog({ dataDir, sourcePath: FIXTURE }),
    ).rejects.toThrow(/--commit SHA is required/);
  });

  it('does not write anything when the validation command has no artifacts', async () => {
    const dataDir = await tempDataDir();
    const filesBefore = await readFile(dataDir, 'utf8').catch(() => 'missing');
    await expect(validateCatalog({ dataDir })).rejects.toThrow(
      CatalogValidationError,
    );
    expect(await readFile(dataDir, 'utf8').catch(() => 'missing')).toBe(
      filesBefore,
    );
  });
});

describe('catalog validation', () => {
  it('detects catalog bytes that no longer match metadata', async () => {
    const dataDir = await tempDataDir();
    await syncFromFixture(dataDir);
    const catalogPath = path.join(dataDir, CATALOG_FILENAME);
    await writeFile(catalogPath, `${await readFile(catalogPath, 'utf8')} `);

    await expect(validateCatalog({ dataDir })).rejects.toThrow(
      /does not match the catalog bytes/,
    );
  });

  it('detects malformed JSON without rewriting artifacts', async () => {
    const dataDir = await tempDataDir();
    await syncFromFixture(dataDir);
    const catalogPath = path.join(dataDir, CATALOG_FILENAME);
    await writeFile(catalogPath, '{ not json');

    await expect(validateCatalog({ dataDir })).rejects.toThrow(/not valid JSON/);
    expect(await readFile(catalogPath, 'utf8')).toBe('{ not json');
  });

  it('validates the bundled catalog artifact', async () => {
    const { catalog, metadata } = await validateCatalog({
      dataDir: BUNDLED_DATA,
    });

    expect(catalog.games.length).toBeGreaterThan(200);
    expect(metadata.counts.games).toBe(catalog.games.length);
    expect(metadata.counts.servers).toBe(
      catalog.games.reduce((total, game) => total + game.servers.length, 0),
    );
    expect(catalog.source.repository).toBe(
      'https://github.com/cicerakes/Game-Time-Master',
    );
    expect(catalog.source.license).toBe('GPL-3.0-only');
    expect(catalog.source.commit).toMatch(/^[0-9a-f]{40}$/);

    for (const game of catalog.games) {
      expect(game.servers.length).toBeGreaterThan(0);
      for (const server of game.servers) {
        expect(server.dailyReset.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(['local', 'utc']).toContain(server.dailyReset.basis);
      }
    }
  });

  it('loads the bundled catalog without any network request', () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network access is not allowed while loading the catalog');
    }) as typeof fetch;

    try {
      resetBundledGameCatalogCache();
      const catalog = loadBundledGameCatalog();
      expect(catalog.games.length).toBeGreaterThan(200);
      expect(loadBundledGameCatalog()).toBe(catalog);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
