import type {
  AppPreferences,
  CustomGameRecord,
  GameSelection,
  LoginCompletion,
  ScheduleOverride,
} from '../storage/types.ts';

export const BACKUP_FORMAT = 'dailies-backup' as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;

export const BACKUP_CATEGORIES = [
  'preferences',
  'selectedGames',
  'customGames',
  'gameSchedules',
  'loginCompletionHistory',
] as const;

export type BackupCategory = (typeof BACKUP_CATEGORIES)[number];
export type ImportMode = 'merge' | 'replace';

/** All locally owned data that a backup may contain. */
export interface BackupData {
  preferences: AppPreferences;
  selectedGames: GameSelection[];
  customGames: CustomGameRecord[];
  gameSchedules: ScheduleOverride[];
  loginCompletionHistory: LoginCompletion[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
  data: BackupData;
}

export interface BackupCategoryCounts {
  /** Records present in the imported file for this category. */
  incoming: number;
  added: number;
  updated: number;
  skipped: number;
  /** Existing local records replaced by a replace import. */
  removed: number;
}

export type BackupCategorySummary = Record<
  BackupCategory,
  BackupCategoryCounts
>;

export interface ImportOptions {
  mode: ImportMode;
  categories: readonly BackupCategory[];
}

export interface ImportPreview {
  mode: ImportMode;
  categories: BackupCategory[];
  counts: BackupCategorySummary;
  warnings: string[];
}

export interface ImportWrites {
  selectedGames?: GameSelection[];
  customGames?: CustomGameRecord[];
  gameSchedules?: ScheduleOverride[];
  loginCompletionHistory?: LoginCompletion[];
}

export interface ImportPlan {
  preview: ImportPreview;
  resulting: BackupData;
  /** Changed records to write; merge leaves unselected local records alone. */
  writes: ImportWrites;
  /** Record categories to clear before writing in replace mode. */
  clearCategories: BackupCategory[];
  replacePreferences: boolean;
}

export interface ImportContext {
  /** Whether this profile already stores preferences in localStorage. */
  hasSavedPreferences: boolean;
}
