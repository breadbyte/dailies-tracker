import { version as appVersion } from '../../../package.json';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  type BackupFile,
} from '../../domain/backup/types.ts';
import { parseBackupFile } from '../../domain/backup/validation.ts';
import { readLocalBackupData } from './localData.ts';

export interface CreateBackupOptions {
  now?: () => Date;
}

export async function createBackupFile(
  options: CreateBackupOptions = {},
): Promise<BackupFile> {
  const now = options.now ?? (() => new Date());
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now().toISOString(),
    appVersion,
    data: await readLocalBackupData(),
  };

  // Reuse the import validator so an export can always be restored.
  return parseBackupFile(backup);
}

export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function backupFileName(backup: BackupFile): string {
  return `dailies-backup-${backup.exportedAt.slice(0, 10)}.json`;
}

/** Creates a local download. No backup content is uploaded anywhere. */
export function downloadBackup(
  backup: BackupFile,
  filename = backupFileName(backup),
): void {
  const blob = new Blob([serializeBackup(backup)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
