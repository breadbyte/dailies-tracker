import type { BackupData } from '../../domain/backup/types.ts';
import {
  listAllLoginCompletions,
  listCustomGames,
  listGameSelections,
  listScheduleOverrides,
} from '../storage/index.ts';
import { loadPreferences } from '../storage/preferences.ts';

/** Reads and validates every locally owned data category for a backup. */
export async function readLocalBackupData(): Promise<BackupData> {
  const [selectedGames, customGames, gameSchedules, loginCompletionHistory] =
    await Promise.all([
      listGameSelections(),
      listCustomGames(),
      listScheduleOverrides(),
      listAllLoginCompletions(),
    ]);

  return {
    preferences: loadPreferences().preferences,
    selectedGames,
    customGames,
    gameSchedules,
    loginCompletionHistory,
  };
}
