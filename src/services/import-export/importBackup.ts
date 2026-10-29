import { planBackupImport } from '../../domain/backup/plan.ts';
import type {
  BackupCategory,
  BackupFile,
  ImportOptions,
  ImportPreview,
} from '../../domain/backup/types.ts';
import { parseBackupFile } from '../../domain/backup/validation.ts';
import { STORE_NAMES, type StoreName } from '../storage/database.ts';
import {
  capturePreferences,
  hasSavedPreferences,
  restorePreferences,
  savePreferences,
} from '../storage/preferences.ts';
import { writeRecords } from '../storage/records.ts';
import { readLocalBackupData } from './localData.ts';

export const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;

export type BackupImportErrorCode =
  | 'too-large'
  | 'invalid-json'
  | 'invalid-backup';

export class BackupImportError extends Error {
  readonly code: BackupImportErrorCode;

  constructor(
    code: BackupImportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BackupImportError';
    this.code = code;
  }
}

const STORE_FOR_CATEGORY: Record<
  Exclude<BackupCategory, 'preferences'>,
  StoreName
> = {
  selectedGames: STORE_NAMES.selections,
  customGames: STORE_NAMES.customGames,
  gameSchedules: STORE_NAMES.scheduleOverrides,
  loginCompletionHistory: STORE_NAMES.loginCompletions,
};

function tooLargeMessage(): string {
  return `The selected backup is larger than ${MAX_BACKUP_FILE_BYTES / (1024 * 1024)} MB.`;
}

export function parseBackupText(text: string): BackupFile {
  if (text.length > MAX_BACKUP_FILE_BYTES) {
    throw new BackupImportError('too-large', tooLargeMessage());
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new BackupImportError(
      'invalid-json',
      'The selected file is not valid JSON.',
      { cause: error },
    );
  }

  try {
    return parseBackupFile(value);
  } catch (error) {
    throw new BackupImportError(
      'invalid-backup',
      error instanceof Error
        ? error.message
        : 'The selected file is not a valid Dailies backup.',
      { cause: error },
    );
  }
}

export async function readBackupFile(file: Blob): Promise<BackupFile> {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    throw new BackupImportError('too-large', tooLargeMessage());
  }

  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    throw new BackupImportError(
      'invalid-json',
      'The selected file could not be read.',
      { cause: error },
    );
  }

  return parseBackupText(text);
}

/** Computes what an import would change without writing anything. */
export async function previewBackupImport(
  backup: BackupFile,
  options: ImportOptions,
): Promise<ImportPreview> {
  const existing = await readLocalBackupData();
  const plan = planBackupImport(existing, backup.data, options, {
    hasSavedPreferences: hasSavedPreferences(),
  });
  return plan.preview;
}

/**
 * Validates the backup again against current local data, then writes the
 * selected categories in one transaction. A replace import is recomputed at
 * apply time so a stale preview cannot overwrite newer local records.
 */
export async function applyBackupImport(
  backup: BackupFile,
  options: ImportOptions,
): Promise<ImportPreview> {
  const existing = await readLocalBackupData();
  const plan = planBackupImport(existing, backup.data, options, {
    hasSavedPreferences: hasSavedPreferences(),
  });

  const snapshot = plan.replacePreferences
    ? capturePreferences()
    : undefined;

  if (plan.replacePreferences) {
    try {
      savePreferences(plan.resulting.preferences);
    } catch (error) {
      if (snapshot !== undefined) {
        try {
          restorePreferences(snapshot);
        } catch {
          // Report the original preference write failure.
        }
      }
      throw error;
    }
  }

  try {
    const clear = plan.clearCategories.flatMap((category) =>
      category === 'preferences' ? [] : [STORE_FOR_CATEGORY[category]],
    );
    const put: Array<{ store: StoreName; value: unknown }> = [];

    for (const category of plan.preview.categories) {
      if (category === 'preferences') continue;
      const store = STORE_FOR_CATEGORY[category];
      for (const value of plan.writes[category] ?? []) {
        put.push({ store, value });
      }
    }

    await writeRecords({ clear, put });
  } catch (error) {
    if (snapshot !== undefined) {
      try {
        restorePreferences(snapshot);
      } catch {
        // Preserve the original transaction error for the caller.
      }
    }
    throw error;
  }

  return plan.preview;
}
