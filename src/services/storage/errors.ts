export type StorageErrorCode =
  | 'unavailable'
  | 'blocked'
  | 'unsupported-version'
  | 'quota-exceeded'
  | 'validation'
  | 'transaction-failed'
  | 'not-found'
  | 'unknown';

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as ErrorLike;
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}

export function toStorageError(
  error: unknown,
  fallback: StorageErrorCode,
  message = 'Local storage operation failed',
): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaExceededError(error)) {
    return new StorageError(
      'quota-exceeded',
      'Local storage is full; free space or export and remove data',
      { cause: error },
    );
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as ErrorLike;
    if (candidate.name === 'VersionError') {
      return new StorageError(
        'unsupported-version',
        'The local database was created by a newer application version',
        { cause: error },
      );
    }
    if (candidate.name === 'SecurityError') {
      return new StorageError(
        'unavailable',
        'Browser storage is blocked by the current browser settings',
        { cause: error },
      );
    }
    if (candidate.name === 'InvalidStateError') {
      return new StorageError(
        'unavailable',
        'The local database is not available',
        { cause: error },
      );
    }
  }
  return new StorageError(fallback, message, { cause: error });
}
