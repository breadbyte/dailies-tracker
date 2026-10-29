import { StorageError } from './errors.ts';

export interface MutationOptions {
  now?: () => Date;
  randomUUID?: () => string;
}

export function nowIso(options?: MutationOptions): string {
  const clock = options?.now ?? (() => new Date());
  return clock().toISOString();
}

export function nextUuid(options?: MutationOptions): string {
  if (options?.randomUUID !== undefined) return options.randomUUID();
  const cryptoApi = globalThis.crypto;
  if (cryptoApi === undefined || typeof cryptoApi.randomUUID !== 'function') {
    throw new StorageError(
      'unavailable',
      'Secure random ID generation is unavailable',
    );
  }
  return cryptoApi.randomUUID();
}

export function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new StorageError('validation', 'Text value must be a string');
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
