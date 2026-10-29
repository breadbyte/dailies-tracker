import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BackupValidationError,
  parseBackupFile,
} from '../../../src/domain/backup/validation.ts';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(`tests/fixtures/backups/${name}`, 'utf8'),
  ) as unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('backup validation', () => {
  it('loads the historical schema version 1 fixture', () => {
    const backup = parseBackupFile(fixture('schema-v1.json'));

    expect(backup.format).toBe('dailies-backup');
    expect(backup.schemaVersion).toBe(1);
    expect(backup.data.selectedGames).toHaveLength(2);
    expect(backup.data.customGames).toHaveLength(1);
    expect(backup.data.gameSchedules[0]?.schedule.kind).toBe('weekly');
    expect(backup.data.loginCompletionHistory).toHaveLength(1);
    expect(backup.data.preferences.theme).toBe('dark');
  });

  it('rejects a backup created by a newer schema version', () => {
    expect(() => parseBackupFile(fixture('schema-v2-future.json'))).toThrow(
      /newer version/,
    );
  });

  it('rejects records with invalid fields and time zones', () => {
    expect(() => parseBackupFile(fixture('malformed-record.json'))).toThrow(
      /valid IANA time zone/,
    );
  });

  it('rejects unknown formats, fields, and non-canonical timestamps', () => {
    const original = fixture('schema-v1.json') as Record<string, unknown>;

    expect(() =>
      parseBackupFile({ ...original, format: 'other-backup' }),
    ).toThrow(/must be/);

    expect(() =>
      parseBackupFile({ ...original, extra: true }),
    ).toThrow(/not a known field/);

    expect(() =>
      parseBackupFile({
        ...original,
        exportedAt: '2026-10-01T12:00:00Z',
      }),
    ).toThrow(/canonical UTC/);
  });

  it('rejects duplicate stable IDs within one category', () => {
    const document = clone(fixture('schema-v1.json')) as {
      data: { selectedGames: unknown[] };
    };
    document.data.selectedGames.push(document.data.selectedGames[0]);

    expect(() => parseBackupFile(document)).toThrow(/must be unique/);
    expect(() => parseBackupFile(document)).toThrow(BackupValidationError);
  });
});
