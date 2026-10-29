import { StorageError, toStorageError } from './errors.ts';
import { openAppDatabase, type StoreName } from './database.ts';

export interface ReadAllOptions {
  index?: string;
  query?: IDBValidKey | IDBKeyRange;
}

function requireFactory(): IDBFactory {
  const factory = globalThis.indexedDB;
  if (factory === undefined) {
    throw new StorageError('unavailable', 'IndexedDB is not available');
  }
  return factory;
}

export function getKeyRange(): typeof IDBKeyRange {
  requireFactory();
  if (typeof IDBKeyRange === 'undefined') {
    throw new StorageError('unavailable', 'IndexedDB key ranges are unavailable');
  }
  return IDBKeyRange;
}

export async function readAllRecords(
  storeName: StoreName,
  options: ReadAllOptions = {},
): Promise<unknown[]> {
  const database = await openAppDatabase();
  return new Promise<unknown[]>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeName, 'readonly');
    } catch (error) {
      reject(toStorageError(error, 'transaction-failed'));
      return;
    }

    const store = transaction.objectStore(storeName);
    const source = options.index === undefined ? store : store.index(options.index);
    let request: IDBRequest<unknown[]>;
    try {
      request =
        options.query === undefined
          ? source.getAll()
          : source.getAll(options.query);
    } catch (error) {
      reject(toStorageError(error, 'transaction-failed'));
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(toStorageError(request.error, 'transaction-failed'));
    };
    transaction.onabort = () => {
      reject(toStorageError(transaction.error, 'transaction-failed'));
    };
  });
}

export async function readRecord(
  storeName: StoreName,
  key: IDBValidKey,
): Promise<unknown | undefined> {
  const database = await openAppDatabase();
  return new Promise<unknown | undefined>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeName, 'readonly');
    } catch (error) {
      reject(toStorageError(error, 'transaction-failed'));
      return;
    }
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as unknown | undefined);
    request.onerror = () => {
      reject(toStorageError(request.error, 'transaction-failed'));
    };
    transaction.onabort = () => {
      reject(toStorageError(transaction.error, 'transaction-failed'));
    };
  });
}

export async function putRecord<T>(
  storeName: StoreName,
  value: T,
): Promise<T> {
  const database = await openAppDatabase();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeName, 'readwrite');
    } catch (error) {
      reject(toStorageError(error, 'transaction-failed'));
      return;
    }
    const request = transaction.objectStore(storeName).put(value);
    request.onerror = () => {
      reject(toStorageError(request.error, 'transaction-failed'));
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => {
      reject(toStorageError(transaction.error, 'transaction-failed'));
    };
  });
}

export interface RecordWrite {
  /** Stores emptied before pending writes, in transaction order. */
  clear?: readonly StoreName[];
  put?: ReadonlyArray<{ store: StoreName; value: unknown }>;
}

/**
 * Applies several store writes in one IndexedDB transaction. Any request
 * failure aborts the whole transaction, so an interrupted import cannot leave
 * a partially updated category behind.
 */
export async function writeRecords(write: RecordWrite): Promise<void> {
  const storeSet = new Set<StoreName>();
  for (const storeName of write.clear ?? []) storeSet.add(storeName);
  for (const entry of write.put ?? []) storeSet.add(entry.store);
  if (storeSet.size === 0) return;

  const database = await openAppDatabase();
  return new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction([...storeSet], 'readwrite');
    } catch (error) {
      reject(toStorageError(error, 'transaction-failed'));
      return;
    }

    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(toStorageError(error, 'transaction-failed'));
    };

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);

    try {
      for (const storeName of write.clear ?? []) {
        transaction.objectStore(storeName).clear();
      }
      for (const entry of write.put ?? []) {
        transaction.objectStore(entry.store).put(entry.value);
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be inactive; report the original error.
      }
      fail(error);
    }
  });
}

export async function deleteRecord(
  storeName: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const database = await openAppDatabase();
  return new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeName, 'readwrite');
    } catch (error) {
      reject(toStorageError(error, 'transaction-failed'));
      return;
    }
    const request = transaction.objectStore(storeName).delete(key);
    request.onerror = () => {
      reject(toStorageError(request.error, 'transaction-failed'));
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      reject(toStorageError(transaction.error, 'transaction-failed'));
    };
  });
}

export function parseStored<T>(
  parser: (value: unknown) => T,
  value: unknown,
  label: string,
): T {
  try {
    return parser(value);
  } catch (error) {
    throw new StorageError('validation', `${label} failed validation`, {
      cause: error,
    });
  }
}
