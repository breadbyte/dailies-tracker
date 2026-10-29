import { describe, expect, it } from 'vitest';
import {
  PREFERENCES_RECOVERY_KEY,
  PREFERENCES_STORAGE_KEY,
  loadPreferences,
  savePreferences,
  updatePreferences,
  type PreferenceStorage,
} from '../../../src/services/storage/preferences.ts';
import { StorageError } from '../../../src/services/storage/errors.ts';
import { createDefaultPreferences } from '../../../src/domain/storage/validation.ts';

class MemoryStorage implements PreferenceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('preferences storage', () => {
  it('loads defaults when nothing is stored', () => {
    const result = loadPreferences(new MemoryStorage());
    expect(result).toEqual({
      preferences: createDefaultPreferences(),
      recovered: false,
    });
  });

  it('saves and reloads validated preferences', () => {
    const storage = new MemoryStorage();
    const saved = savePreferences(
      {
        ...createDefaultPreferences(),
        theme: 'dark',
        locale: 'de-DE',
        displayTimeZone: 'Europe/Berlin',
        dashboardSort: 'name',
        collapsedSections: ['weekly'],
      },
      storage,
    );

    expect(loadPreferences(storage).preferences).toEqual(saved);
  });

  it('merges preference updates', () => {
    const storage = new MemoryStorage();
    savePreferences(createDefaultPreferences(), storage);
    expect(updatePreferences({ theme: 'light' }, storage).theme).toBe('light');
    expect(loadPreferences(storage).preferences.theme).toBe('light');
  });

  it('persists the artwork source and per-game choices', () => {
    const storage = new MemoryStorage();
    const saved = savePreferences(
      {
        ...createDefaultPreferences(),
        artworkSource: 'steamgriddb',
        artworkChoices: { 'afk-arena': 123 },
      },
      storage,
    );

    expect(loadPreferences(storage).preferences).toEqual(saved);
    expect(saved.artworkSource).toBe('steamgriddb');
    expect(saved.artworkChoices['afk-arena']).toBe(123);
  });

  it('defaults missing artwork fields for older preferences', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        theme: 'dark',
        dashboardSort: 'catalog',
        collapsedSections: [],
      }),
    );

    const result = loadPreferences(storage);
    expect(result.recovered).toBe(false);
    expect(result.preferences.artworkSource).toBe('none');
    expect(result.preferences.artworkChoices).toEqual({});
  });

  it('recovers corrupt preferences and preserves the raw value', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, '{not json');

    const result = loadPreferences(storage);
    expect(result.recovered).toBe(true);
    expect(result.warning?.code).toBe('validation');
    expect(result.preferences).toEqual(createDefaultPreferences());
    expect(JSON.parse(storage.getItem(PREFERENCES_RECOVERY_KEY) ?? '{}')).toMatchObject({
      raw: '{not json',
    });
    expect(storage.getItem(PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify(createDefaultPreferences()),
    );
  });

  it('recovers unsupported preference versions', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...createDefaultPreferences(), schemaVersion: 99 }),
    );

    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    const result = loadPreferences(storage);
    expect(result.recovered).toBe(true);
    expect(result.warning?.code).toBe('validation');
    expect(storage.getItem(PREFERENCES_STORAGE_KEY)).toBe(raw);
  });

  it('rejects invalid preferences at the write boundary', () => {
    const storage = new MemoryStorage();
    expect(() =>
      savePreferences(
        {
          ...createDefaultPreferences(),
          theme: 'neon',
        } as never,
        storage,
      ),
    ).toThrow(StorageError);
    expect(storage.values.size).toBe(0);
  });

  it('maps quota failures to a typed storage error', () => {
    const storage: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error('full'), {
          name: 'QuotaExceededError',
        });
      },
    };

    expect(() => savePreferences(createDefaultPreferences(), storage)).toThrow(
      expect.objectContaining({ code: 'quota-exceeded' }),
    );
  });

  it('returns defaults when preference storage is unavailable', () => {
    const storage: PreferenceStorage = {
      getItem: () => {
        throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      },
      setItem: () => {
        throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      },
    };

    const result = loadPreferences(storage);
    expect(result.preferences).toEqual(createDefaultPreferences());
    expect(result.warning?.code).toBe('unavailable');
    expect(() => savePreferences(createDefaultPreferences(), storage)).toThrow(
      expect.objectContaining({ code: 'unavailable' }),
    );
  });
});
