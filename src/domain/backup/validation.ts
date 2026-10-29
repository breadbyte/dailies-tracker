import {
  parseAppPreferences,
  parseCustomGame,
  parseGameSelection,
  parseLoginCompletion,
  parseScheduleOverride,
} from '../storage/validation.ts';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  type BackupData,
  type BackupFile,
} from './types.ts';

const MAX_BACKUP_RECORDS = 50_000;
const MAX_APP_VERSION_LENGTH = 40;

type UnknownRecord = Record<string, unknown>;

export class BackupValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'BackupValidationError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new BackupValidationError(path, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail(path, 'must be an object');
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function asString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') fail(path, 'must be a string');
  if (value.trim() === '') fail(path, 'must not be empty');
  if (value.length > maxLength) {
    fail(path, `must be at most ${maxLength} characters`);
  }
  return value;
}

function asIsoTimestamp(value: unknown, path: string): string {
  const text = asString(value, path, 40);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) fail(path, 'must be an ISO 8601 timestamp');
  if (new Date(parsed).toISOString() !== text) {
    fail(path, 'must be a canonical UTC ISO 8601 timestamp');
  }
  return text;
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, 'is not a known field');
  }
}

function parseCollection<T extends { id: string }>(
  value: unknown,
  path: string,
  parser: (entry: unknown) => T,
): T[] {
  const values = asArray(value, path);
  if (values.length > MAX_BACKUP_RECORDS) {
    fail(path, `must contain at most ${MAX_BACKUP_RECORDS} records`);
  }

  const seenIds = new Set<string>();
  return values.map((entry, index) => {
    let parsed: T;
    try {
      parsed = parser(entry);
    } catch (error) {
      fail(
        `${path}[${index}]`,
        error instanceof Error ? error.message : 'is invalid',
      );
    }
    if (seenIds.has(parsed.id)) {
      fail(`${path}[${index}].id`, 'must be unique');
    }
    seenIds.add(parsed.id);
    return parsed;
  });
}

function parsePreferences(value: unknown) {
  try {
    return parseAppPreferences(value);
  } catch (error) {
    fail(
      'backup.data.preferences',
      error instanceof Error ? error.message : 'are invalid',
    );
  }
}

function parseData(value: unknown): BackupData {
  const data = asRecord(value, 'backup.data');
  rejectUnknownKeys(
    data,
    [
      'preferences',
      'selectedGames',
      'customGames',
      'gameSchedules',
      'loginCompletionHistory',
    ],
    'backup.data',
  );

  return {
    preferences: parsePreferences(data.preferences),
    selectedGames: parseCollection(
      data.selectedGames,
      'backup.data.selectedGames',
      parseGameSelection,
    ),
    customGames: parseCollection(
      data.customGames,
      'backup.data.customGames',
      parseCustomGame,
    ),
    gameSchedules: parseCollection(
      data.gameSchedules,
      'backup.data.gameSchedules',
      parseScheduleOverride,
    ),
    loginCompletionHistory: parseCollection(
      data.loginCompletionHistory,
      'backup.data.loginCompletionHistory',
      parseLoginCompletion,
    ),
  };
}

/**
 * Validates an untrusted backup document without executing content.
 *
 * Only the current schema version is accepted. A document from a newer
 * application is rejected before any storage is changed.
 */
export function parseBackupFile(value: unknown): BackupFile {
  const backup = asRecord(value, 'backup');
  rejectUnknownKeys(
    backup,
    ['format', 'schemaVersion', 'exportedAt', 'appVersion', 'data'],
    'backup',
  );

  if (backup.format !== BACKUP_FORMAT) {
    fail('backup.format', `must be \`${BACKUP_FORMAT}\``);
  }

  const schemaVersion = backup.schemaVersion;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isSafeInteger(schemaVersion)
  ) {
    fail('backup.schemaVersion', 'must be an integer');
  }
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    fail(
      'backup.schemaVersion',
      `was created by a newer version; this app supports up to version ${BACKUP_SCHEMA_VERSION}`,
    );
  }
  if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    fail(
      'backup.schemaVersion',
      `is not supported; this app supports version ${BACKUP_SCHEMA_VERSION}`,
    );
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: asIsoTimestamp(backup.exportedAt, 'backup.exportedAt'),
    appVersion: asString(
      backup.appVersion,
      'backup.appVersion',
      MAX_APP_VERSION_LENGTH,
    ),
    data: parseData(backup.data),
  };
}
