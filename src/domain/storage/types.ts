import type { ArtworkSource } from '../artwork/types.ts';
import type { DailyResetDefinition, GameServerDefinition } from '../catalog/types.ts';
import type { Schedule } from '../schedule/types.ts';

export const PREFERENCES_SCHEMA_VERSION = 1 as const;

export type ThemePreference = 'system' | 'light' | 'dark';
export type DashboardSort = 'catalog' | 'name' | 'next-reset';

export interface AppPreferences {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION;
  theme: ThemePreference;
  locale?: string;
  displayTimeZone?: string;
  dashboardSort: DashboardSort;
  collapsedSections: string[];
  /** Optional artwork provider. `none` keeps local-only behavior. */
  artworkSource: ArtworkSource;
  /** Per-game chosen SteamGridDB grid ID; absent means top-rated. */
  artworkChoices: Record<string, number>;
}

export interface GameSelection {
  id: string;
  gameId: string;
  serverId: string;
  enabled: boolean;
  customDisplayName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameSelectionInput {
  gameId: string;
  serverId: string;
  enabled?: boolean;
  customDisplayName?: string;
  notes?: string;
}

export interface GameSelectionUpdate {
  enabled?: boolean;
  customDisplayName?: string | null;
  notes?: string | null;
}

export interface ScheduleOverride {
  id: string;
  gameId: string;
  serverId: string;
  schedule: Schedule;
  updatedAt: string;
}

export interface ScheduleOverrideInput {
  gameId: string;
  serverId: string;
  schedule: Schedule;
}

export interface CustomGameServerDraft {
  id?: string;
  name: string;
  timeZone: string;
  dailyReset: DailyResetDefinition;
}

export interface CustomGameDraft {
  name: string;
  menuName?: string;
  servers: CustomGameServerDraft[];
}

export interface CustomGameRecord {
  id: string;
  name: string;
  menuName?: string;
  servers: GameServerDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface LoginCompletion {
  id: string;
  gameId: string;
  serverId: string;
  completedAt: string;
  taskId?: string;
  notes?: string;
}

export interface LoginCompletionInput {
  gameId: string;
  serverId: string;
  completedAt?: string;
  taskId?: string;
  notes?: string;
}

export interface LoginCompletionFilter {
  gameId?: string;
  serverId?: string;
  from?: string;
  to?: string;
  limit?: number;
}
