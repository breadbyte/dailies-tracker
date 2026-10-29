import { StorageError, toStorageError } from './errors.ts';

export const DATABASE_NAME = 'dailies';
export const DATABASE_VERSION = 3;

export const STORE_NAMES = {
  selections: 'gameSelections',
  customGames: 'customGames',
  loginCompletions: 'loginCompletions',
  scheduleOverrides: 'scheduleOverrides',
  artworkCache: 'artworkCache',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

type Migration = (
  database: IDBDatabase,
  transaction: IDBTransaction,
) => void;

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1(database) {
    const selections = database.createObjectStore(STORE_NAMES.selections, {
      keyPath: 'id',
    });
    selections.createIndex('gameId', 'gameId');

    database.createObjectStore(STORE_NAMES.customGames, { keyPath: 'id' });

    const completions = database.createObjectStore(
      STORE_NAMES.loginCompletions,
      { keyPath: 'id' },
    );
    completions.createIndex('gameId', 'gameId');
    completions.createIndex('gameServerCompletedAt', [
      'gameId',
      'serverId',
      'completedAt',
    ]);
    completions.createIndex('completedAt', 'completedAt');
  },
  2(database) {
    database.createObjectStore(STORE_NAMES.scheduleOverrides, {
      keyPath: 'id',
    });
  },
  3(database) {
    database.createObjectStore(STORE_NAMES.artworkCache, {
      keyPath: 'key',
    });
  },
};

export function applyMigrations(
  database: IDBDatabase,
  oldVersion: number,
  newVersion: number,
  transaction: IDBTransaction,
): void {
  if (newVersion > DATABASE_VERSION) {
    throw new StorageError(
      'unsupported-version',
      `Database version ${newVersion} is newer than supported version ${DATABASE_VERSION}`,
    );
  }
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migration = MIGRATIONS[version];
    if (migration === undefined) {
      throw new StorageError(
        'unsupported-version',
        `No migration exists for database version ${version}`,
      );
    }
    migration(database, transaction);
  }
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (factory === undefined) {
    return Promise.reject(
      new StorageError('unavailable', 'IndexedDB is not available'),
    );
  }

  let request: IDBOpenDBRequest;
  try {
    request = factory.open(DATABASE_NAME, DATABASE_VERSION);
  } catch (error) {
    return Promise.reject(toStorageError(error, 'unavailable'));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let upgradeError: unknown;

    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (transaction === null) {
        upgradeError = new StorageError(
          'transaction-failed',
          'Database upgrade transaction is unavailable',
        );
        return;
      }
      try {
        applyMigrations(
          request.result,
          event.oldVersion,
          event.newVersion ?? DATABASE_VERSION,
          transaction,
        );
      } catch (error) {
        upgradeError = error;
        transaction.abort();
      }
    };

    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(
        new StorageError(
          'blocked',
          'Close other tabs of this application to finish updating local storage',
        ),
      );
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(
        upgradeError === undefined
          ? toStorageError(request.error, 'unavailable')
          : toStorageError(upgradeError, 'transaction-failed'),
      );
    };

    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
  });
}

export function openAppDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  if (factory !== undefined) return openDatabase(factory);
  if (databasePromise === undefined) {
    const pending = openDatabase(globalThis.indexedDB);
    databasePromise = pending;
    pending.catch(() => {
      if (databasePromise === pending) databasePromise = undefined;
    });
  }
  return databasePromise;
}

export async function closeAppDatabase(): Promise<void> {
  const current = databasePromise;
  databasePromise = undefined;
  if (current === undefined) return;
  try {
    const database = await current;
    database.close();
  } catch {
    return;
  }
}

export async function deleteAppDatabase(factory?: IDBFactory): Promise<void> {
  await closeAppDatabase();
  const resolved = factory ?? globalThis.indexedDB;
  if (resolved === undefined) {
    throw new StorageError('unavailable', 'IndexedDB is not available');
  }

  await new Promise<void>((resolve, reject) => {
    const request = resolved.deleteDatabase(DATABASE_NAME);
    request.onerror = () => {
      reject(toStorageError(request.error, 'transaction-failed'));
    };
    request.onblocked = () => {
      reject(
        new StorageError(
          'blocked',
          'Close other tabs of this application to delete local storage',
        ),
      );
    };
    request.onsuccess = () => resolve();
  });
}
