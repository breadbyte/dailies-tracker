import {
  createDefaultPreferences,
  migratePreferences,
  parseAppPreferences,
  StorageValidationError,
} from '../../domain/storage/validation.ts';
import type { AppPreferences } from '../../domain/storage/types.ts';
import { StorageError, toStorageError } from './errors.ts';

export const PREFERENCES_STORAGE_KEY = 'dailies:preferences';
export const PREFERENCES_RECOVERY_KEY = 'dailies:preferences:recovery';

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PreferencesSnapshot {
  raw: string | null;
}

export interface PreferencesLoadResult {
  preferences: AppPreferences;
  recovered: boolean;
  warning?: StorageError;
}

function resolveStorage(storage?: PreferenceStorage): PreferenceStorage {
  if (storage !== undefined) return storage;
  try {
    const candidate = globalThis.localStorage;
    if (candidate !== undefined) return candidate;
  } catch (error) {
    throw toStorageError(
      error,
      'unavailable',
      'Local preferences storage is blocked',
    );
  }
  throw new StorageError('unavailable', 'Local preferences storage is unavailable');
}

export function loadPreferences(
  storage?: PreferenceStorage,
): PreferencesLoadResult {
  let resolved: PreferenceStorage;
  try {
    resolved = resolveStorage(storage);
  } catch (error) {
    return {
      preferences: createDefaultPreferences(),
      recovered: false,
      warning: toStorageError(error, 'unavailable'),
    };
  }

  let raw: string | null;
  try {
    raw = resolved.getItem(PREFERENCES_STORAGE_KEY);
  } catch (error) {
    return {
      preferences: createDefaultPreferences(),
      recovered: false,
      warning: toStorageError(error, 'unavailable'),
    };
  }

  if (raw === null) {
    return { preferences: createDefaultPreferences(), recovered: false };
  }

  try {
    return {
      preferences: migratePreferences(JSON.parse(raw) as unknown),
      recovered: false,
    };
  } catch (error) {
    const warning = new StorageError(
      'validation',
      'Stored preferences were invalid; defaults were loaded',
      { cause: error },
    );
    const defaults = createDefaultPreferences();
    if (
      error instanceof StorageValidationError &&
      error.path === 'preferences.schemaVersion'
    ) {
      return { preferences: defaults, recovered: true, warning };
    }
    let preserved = true;
    try {
      resolved.setItem(
        PREFERENCES_RECOVERY_KEY,
        JSON.stringify({ preservedAt: new Date().toISOString(), raw }),
      );
    } catch {
      preserved = false;
    }
    if (preserved) {
      try {
        resolved.setItem(
          PREFERENCES_STORAGE_KEY,
          JSON.stringify(defaults),
        );
      } catch {
        return { preferences: defaults, recovered: true, warning };
      }
    }
    return { preferences: defaults, recovered: true, warning };
  }
}

/** True when this profile has a stored preference value (valid or not). */
export function hasSavedPreferences(storage?: PreferenceStorage): boolean {
  try {
    return resolveStorage(storage).getItem(PREFERENCES_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Captures the raw preference value so a failed import can restore it. */
export function capturePreferences(
  storage?: PreferenceStorage,
): PreferencesSnapshot {
  const resolved = resolveStorage(storage);
  try {
    return { raw: resolved.getItem(PREFERENCES_STORAGE_KEY) };
  } catch (error) {
    throw toStorageError(error, 'unavailable', 'Could not read preferences');
  }
}

export function restorePreferences(
  snapshot: PreferencesSnapshot,
  storage?: PreferenceStorage,
): void {  const resolved = resolveStorage(storage);
  try {
    if (snapshot.raw !== null) {
      resolved.setItem(PREFERENCES_STORAGE_KEY, snapshot.raw);
      return;
    }
    if (resolved.removeItem !== undefined) {
      resolved.removeItem(PREFERENCES_STORAGE_KEY);
      return;
    }
    resolved.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify(createDefaultPreferences()),
    );
  } catch (error) {
    throw toStorageError(error, 'unavailable', 'Could not restore preferences');
  }
}

/** Removes stored preferences and any preserved corrupt copy. */
export function clearStoredPreferences(storage?: PreferenceStorage): void {
  const resolved = resolveStorage(storage);
  try {
    if (resolved.removeItem !== undefined) {
      resolved.removeItem(PREFERENCES_STORAGE_KEY);
      resolved.removeItem(PREFERENCES_RECOVERY_KEY);
      return;
    }
    resolved.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify(createDefaultPreferences()),
    );
  } catch (error) {
    throw toStorageError(error, 'unavailable', 'Could not clear preferences');
  }
}

export function savePreferences(
  preferences: AppPreferences,
  storage?: PreferenceStorage,
): AppPreferences {  let validated: AppPreferences;
  try {
    validated = parseAppPreferences(preferences);
  } catch (error) {
    throw new StorageError('validation', 'Invalid preferences', {
      cause: error,
    });
  }

  const resolved = resolveStorage(storage);
  try {
    resolved.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(validated));
  } catch (error) {
    throw toStorageError(error, 'unavailable', 'Could not save preferences');
  }
  return validated;
}

export function updatePreferences(
  patch: Partial<Omit<AppPreferences, 'schemaVersion'>>,
  storage?: PreferenceStorage,
): AppPreferences {
  const current = loadPreferences(storage);
  let next: AppPreferences;
  try {
    next = parseAppPreferences({
      ...current.preferences,
      ...patch,
      schemaVersion: current.preferences.schemaVersion,
    });
  } catch (error) {
    throw new StorageError('validation', 'Invalid preferences update', {
      cause: error,
    });
  }
  return savePreferences(next, storage);
}
