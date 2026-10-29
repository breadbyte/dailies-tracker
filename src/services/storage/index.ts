export {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_NAMES,
  closeAppDatabase,
  deleteAppDatabase,
  openAppDatabase,
} from './database.ts';
export {
  StorageError,
  isQuotaExceededError,
  toStorageError,
  type StorageErrorCode,
} from './errors.ts';
export {
  PREFERENCES_RECOVERY_KEY,
  PREFERENCES_STORAGE_KEY,
  loadPreferences,
  savePreferences,
  updatePreferences,
  type PreferenceStorage,
  type PreferencesLoadResult,
} from './preferences.ts';
export {
  createGameSelectionId,
  getGameSelection,
  listGameSelections,
  removeGameSelection,
  selectGameServer,
  updateGameSelection,
} from './selectedGames.ts';
export {
  createCustomGame,
  deleteCustomGame,
  getCustomGame,
  listCustomGames,
  updateCustomGame,
} from './customGames.ts';
export {
  deleteLoginCompletion,
  getLatestLoginCompletion,
  listAllLoginCompletions,
  listLoginCompletions,
  recordLoginCompletion,
} from './loginHistory.ts';
export {
  deleteScheduleOverride,
  getScheduleOverride,
  listScheduleOverrides,
  setScheduleOverride,
} from './scheduleOverrides.ts';
export {
  readArtworkCacheEntry,
  writeArtworkCacheEntry,
} from './artworkCache.ts';
export type { MutationOptions } from './common.ts';
export type {
  AppPreferences,
  CustomGameDraft,
  CustomGameRecord,
  CustomGameServerDraft,
  DashboardSort,
  GameSelection,
  GameSelectionInput,
  GameSelectionUpdate,
  LoginCompletion,
  LoginCompletionFilter,
  LoginCompletionInput,
  ScheduleOverride,
  ScheduleOverrideInput,
  ThemePreference,
} from '../../domain/storage/types.ts';
