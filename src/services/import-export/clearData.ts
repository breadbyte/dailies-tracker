import { deleteAppDatabase } from '../storage/database.ts';
import { clearStoredPreferences } from '../storage/preferences.ts';

/**
 * Deletes every local record and preference. The caller must obtain explicit
 * confirmation before invoking this destructive operation.
 */
export async function clearAllLocalData(): Promise<void> {
  await deleteAppDatabase();
  clearStoredPreferences();
}
