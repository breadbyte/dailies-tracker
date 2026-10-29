import type { ArtworkSource } from '../artwork/types.ts';
import type { DailyResetDefinition, GameServerDefinition } from '../catalog/types.ts';
import {
  isValidDailyResetTime,
  isValidTimeZone,
} from '../catalog/validation.ts';
import { parseSchedule } from '../schedule/validation.ts';
import {
  PREFERENCES_SCHEMA_VERSION,
  type AppPreferences,
  type CustomGameRecord,
  type DashboardSort,
  type GameSelection,
  type LoginCompletion,
  type ScheduleOverride,
  type ThemePreference,
} from './types.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CATALOG_GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATALOG_SERVER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CUSTOM_SERVER_SLUG_PATTERN = /^s_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_NAME_LENGTH = 120;
const MAX_NOTES_LENGTH = 2000;
const MAX_SERVERS = 50;
const MAX_COLLAPSED_SECTIONS = 20;
const MAX_ARTWORK_CHOICES = 500;

type UnknownRecord = Record<string, unknown>;

export class StorageValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'StorageValidationError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new StorageValidationError(path, message);
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

function optionalString(
  value: unknown,
  path: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, path, maxLength);
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
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

export function parseStorageTimestamp(value: unknown, path = 'timestamp'): string {
  return asIsoTimestamp(value, path);
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

export function isCustomGameId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('custom_') &&
    UUID_PATTERN.test(value.slice(7))
  );
}

export function isCatalogGameId(value: unknown): value is string {
  return typeof value === 'string' && CATALOG_GAME_ID_PATTERN.test(value);
}

export function isValidGameId(value: unknown): value is string {
  return isCatalogGameId(value) || isCustomGameId(value);
}

export function isValidServerId(
  gameId: unknown,
  serverId: unknown,
): boolean {
  if (
    typeof gameId !== 'string' ||
    typeof serverId !== 'string' ||
    !isValidGameId(gameId)
  ) {
    return false;
  }
  const prefix = `${gameId}:`;
  if (!serverId.startsWith(prefix)) return false;
  const slug = serverId.slice(prefix.length);
  return isCustomGameId(gameId)
    ? CUSTOM_SERVER_SLUG_PATTERN.test(slug)
    : CATALOG_SERVER_SLUG_PATTERN.test(slug);
}

export function selectionIdFor(gameId: string, serverId: string): string {
  if (!isValidGameId(gameId)) {
    fail('gameId', 'must be a catalog slug or custom game ID');
  }
  if (!isValidServerId(gameId, serverId)) {
    fail('serverId', 'must be a valid server ID for the game');
  }
  return `${gameId}::${serverId}`;
}

export function customGameIdFromUuid(uuid: string): string {
  if (typeof uuid !== 'string' || !UUID_PATTERN.test(uuid)) {
    fail('uuid', 'must be a lowercase UUID');
  }
  return `custom_${uuid}`;
}

export function customServerIdFromUuid(gameId: string, uuid: string): string {
  if (!isCustomGameId(gameId)) fail('gameId', 'must be a custom game ID');
  if (typeof uuid !== 'string' || !UUID_PATTERN.test(uuid)) {
    fail('uuid', 'must be a lowercase UUID');
  }
  return `${gameId}:s_${uuid}`;
}

export function createDefaultPreferences(): AppPreferences {
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    theme: 'system',
    dashboardSort: 'catalog',
    collapsedSections: [],
    artworkSource: 'none',
    artworkChoices: {},
  };
}

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const ARTWORK_SOURCES: readonly ArtworkSource[] = ['none', 'steamgriddb'];
const DASHBOARD_SORTS: readonly DashboardSort[] = [
  'catalog',
  'name',
  'next-reset',
];

export function parseAppPreferences(value: unknown): AppPreferences {
  const preferences = asRecord(value, 'preferences');
  rejectUnknownKeys(
    preferences,
    [
      'schemaVersion',
      'theme',
      'locale',
      'displayTimeZone',
      'dashboardSort',
      'collapsedSections',
      'artworkSource',
      'artworkChoices',
    ],
    'preferences',
  );

  if (preferences.schemaVersion !== PREFERENCES_SCHEMA_VERSION) {
    fail(
      'preferences.schemaVersion',
      `unsupported preferences schema; expected ${PREFERENCES_SCHEMA_VERSION}`,
    );
  }

  const theme = asString(preferences.theme, 'preferences.theme', 16);
  if (!THEMES.includes(theme as ThemePreference)) {
    fail('preferences.theme', 'must be `system`, `light`, or `dark`');
  }

  const dashboardSort = asString(
    preferences.dashboardSort,
    'preferences.dashboardSort',
    16,
  );
  if (!DASHBOARD_SORTS.includes(dashboardSort as DashboardSort)) {
    fail('preferences.dashboardSort', 'is not a supported sort order');
  }

  const locale = optionalString(preferences.locale, 'preferences.locale', 35);
  if (locale !== undefined) {
    try {
      Intl.getCanonicalLocales(locale);
    } catch {
      fail('preferences.locale', 'must be a valid BCP 47 language tag');
    }
  }

  const displayTimeZone = optionalString(
    preferences.displayTimeZone,
    'preferences.displayTimeZone',
    100,
  );
  if (displayTimeZone !== undefined && !isValidTimeZone(displayTimeZone)) {
    fail('preferences.displayTimeZone', 'must be a valid IANA time zone');
  }

  const collapsedSections = asArray(
    preferences.collapsedSections,
    'preferences.collapsedSections',
  );
  if (collapsedSections.length > MAX_COLLAPSED_SECTIONS) {
    fail(
      'preferences.collapsedSections',
      `must contain at most ${MAX_COLLAPSED_SECTIONS} entries`,
    );
  }
  const seenSections = new Set<string>();
  const parsedSections = collapsedSections.map((section, index) => {
    const parsed = asString(
      section,
      `preferences.collapsedSections[${index}]`,
      64,
    );
    if (seenSections.has(parsed)) {
      fail(
        `preferences.collapsedSections[${index}]`,
        'must not repeat a section ID',
      );
    }
    seenSections.add(parsed);
    return parsed;
  });

  const artworkSource =
    preferences.artworkSource === undefined
      ? 'none'
      : asString(
          preferences.artworkSource,
          'preferences.artworkSource',
          16,
        );
  if (!ARTWORK_SOURCES.includes(artworkSource as ArtworkSource)) {
    fail(
      'preferences.artworkSource',
      'must be `none` or `steamgriddb`',
    );
  }

  const artworkChoices =
    preferences.artworkChoices === undefined
      ? {}
      : parseArtworkChoices(preferences.artworkChoices);

  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    theme: theme as ThemePreference,
    ...(locale === undefined ? {} : { locale }),
    ...(displayTimeZone === undefined ? {} : { displayTimeZone }),
    dashboardSort: dashboardSort as DashboardSort,
    collapsedSections: parsedSections,
    artworkSource: artworkSource as ArtworkSource,
    artworkChoices,
  };
}

function parseArtworkChoices(value: unknown): Record<string, number> {
  const choices = asRecord(value, 'preferences.artworkChoices');
  const entries = Object.entries(choices);
  if (entries.length > MAX_ARTWORK_CHOICES) {
    fail(
      'preferences.artworkChoices',
      `must contain at most ${MAX_ARTWORK_CHOICES} entries`,
    );
  }

  const parsed: Record<string, number> = {};
  for (const [gameId, imageId] of entries) {
    if (!isValidGameId(gameId)) {
      fail(
        `preferences.artworkChoices.${gameId}`,
        'key must be a game ID',
      );
    }
    if (
      typeof imageId !== 'number' ||
      !Number.isSafeInteger(imageId) ||
      imageId < 1
    ) {
      fail(
        `preferences.artworkChoices.${gameId}`,
        'must be a positive integer grid ID',
      );
    }
    parsed[gameId] = imageId;
  }
  return parsed;
}

export function migratePreferences(value: unknown): AppPreferences {
  if (!isRecord(value)) fail('preferences', 'must be an object');
  return parseAppPreferences(value);
}

export function parseGameSelection(value: unknown): GameSelection {
  const selection = asRecord(value, 'selection');
  rejectUnknownKeys(
    selection,
    [
      'id',
      'gameId',
      'serverId',
      'enabled',
      'customDisplayName',
      'notes',
      'createdAt',
      'updatedAt',
    ],
    'selection',
  );

  const gameId = asString(selection.gameId, 'selection.gameId', 80);
  if (!isValidGameId(gameId)) {
    fail('selection.gameId', 'must be a catalog slug or custom game ID');
  }

  const serverId = asString(selection.serverId, 'selection.serverId', 160);
  if (!isValidServerId(gameId, serverId)) {
    fail('selection.serverId', 'must be a valid server ID for the game');
  }

  const expectedId = selectionIdFor(gameId, serverId);
  if (selection.id !== expectedId) {
    fail('selection.id', `must be \`${expectedId}\``);
  }

  return {
    id: expectedId,
    gameId,
    serverId,
    enabled: asBoolean(selection.enabled, 'selection.enabled'),
    ...(selection.customDisplayName === undefined
      ? {}
      : {
          customDisplayName: asString(
            selection.customDisplayName,
            'selection.customDisplayName',
            MAX_NAME_LENGTH,
          ),
        }),
    ...(selection.notes === undefined
      ? {}
      : {
          notes: asString(
            selection.notes,
            'selection.notes',
            MAX_NOTES_LENGTH,
          ),
        }),
    createdAt: asIsoTimestamp(selection.createdAt, 'selection.createdAt'),
    updatedAt: asIsoTimestamp(selection.updatedAt, 'selection.updatedAt'),
  };
}

function parseDailyReset(
  value: unknown,
  path: string,
): DailyResetDefinition {
  const reset = asRecord(value, path);
  rejectUnknownKeys(reset, ['time', 'basis'], path);
  const time = asString(reset.time, `${path}.time`, 5);
  if (!isValidDailyResetTime(time)) {
    fail(`${path}.time`, 'must be a valid HH:mm time');
  }
  const basis = asString(reset.basis, `${path}.basis`, 8);
  if (basis !== 'local' && basis !== 'utc') {
    fail(`${path}.basis`, 'must be `local` or `utc`');
  }
  return { time, basis };
}

function parseCustomServer(
  value: unknown,
  path: string,
  gameId: string,
): GameServerDefinition {
  const server = asRecord(value, path);
  rejectUnknownKeys(
    server,
    ['id', 'name', 'timeZone', 'icon', 'dailyReset'],
    path,
  );

  const id = asString(server.id, `${path}.id`, 160);
  if (!isValidServerId(gameId, id)) {
    fail(`${path}.id`, 'must be a valid custom server ID');
  }
  const timeZone = asString(server.timeZone, `${path}.timeZone`, 100);
  if (!isValidTimeZone(timeZone)) {
    fail(`${path}.timeZone`, 'must be a valid IANA time zone');
  }

  return {
    id,
    name: asString(server.name, `${path}.name`, MAX_NAME_LENGTH),
    timeZone,
    ...(server.icon === undefined
      ? {}
      : { icon: asString(server.icon, `${path}.icon`, 200) }),
    dailyReset: parseDailyReset(server.dailyReset, `${path}.dailyReset`),
  };
}

export function parseCustomGame(value: unknown): CustomGameRecord {
  const game = asRecord(value, 'customGame');
  rejectUnknownKeys(
    game,
    ['id', 'name', 'menuName', 'servers', 'createdAt', 'updatedAt'],
    'customGame',
  );

  const id = asString(game.id, 'customGame.id', 60);
  if (!isCustomGameId(id)) {
    fail('customGame.id', 'must be a custom game ID');
  }

  const servers = asArray(game.servers, 'customGame.servers');
  if (servers.length === 0) fail('customGame.servers', 'must not be empty');
  if (servers.length > MAX_SERVERS) {
    fail(
      'customGame.servers',
      `must contain at most ${MAX_SERVERS} entries`,
    );
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const parsedServers = servers.map((server, index) => {
    const parsed = parseCustomServer(
      server,
      `customGame.servers[${index}]`,
      id,
    );
    if (seenIds.has(parsed.id)) {
      fail(`customGame.servers[${index}].id`, 'must be unique');
    }
    if (seenNames.has(parsed.name)) {
      fail(`customGame.servers[${index}].name`, 'must be unique');
    }
    seenIds.add(parsed.id);
    seenNames.add(parsed.name);
    return parsed;
  });

  return {
    id,
    name: asString(game.name, 'customGame.name', MAX_NAME_LENGTH),
    ...(game.menuName === undefined
      ? {}
      : {
          menuName: asString(
            game.menuName,
            'customGame.menuName',
            MAX_NAME_LENGTH,
          ),
        }),
    servers: parsedServers,
    createdAt: asIsoTimestamp(game.createdAt, 'customGame.createdAt'),
    updatedAt: asIsoTimestamp(game.updatedAt, 'customGame.updatedAt'),
  };
}

export function parseLoginCompletion(value: unknown): LoginCompletion {
  const completion = asRecord(value, 'loginCompletion');
  rejectUnknownKeys(
    completion,
    ['id', 'gameId', 'serverId', 'completedAt', 'taskId', 'notes'],
    'loginCompletion',
  );

  const id = asString(completion.id, 'loginCompletion.id', 36);
  if (!UUID_PATTERN.test(id)) {
    fail('loginCompletion.id', 'must be a lowercase UUID');
  }

  const gameId = asString(completion.gameId, 'loginCompletion.gameId', 80);
  if (!isValidGameId(gameId)) {
    fail('loginCompletion.gameId', 'must be a catalog slug or custom game ID');
  }
  const serverId = asString(
    completion.serverId,
    'loginCompletion.serverId',
    160,
  );
  if (!isValidServerId(gameId, serverId)) {
    fail('loginCompletion.serverId', 'must be a valid server ID for the game');
  }

  return {
    id,
    gameId,
    serverId,
    completedAt: asIsoTimestamp(
      completion.completedAt,
      'loginCompletion.completedAt',
    ),
    ...(completion.taskId === undefined
      ? {}
      : {
          taskId: asString(
            completion.taskId,
            'loginCompletion.taskId',
            MAX_NAME_LENGTH,
          ),
        }),
    ...(completion.notes === undefined
      ? {}
      : {
          notes: asString(
            completion.notes,
            'loginCompletion.notes',
            MAX_NOTES_LENGTH,
          ),
        }),
  };
}

export function parseScheduleOverride(value: unknown): ScheduleOverride {
  const override = asRecord(value, 'scheduleOverride');
  rejectUnknownKeys(
    override,
    ['id', 'gameId', 'serverId', 'schedule', 'updatedAt'],
    'scheduleOverride',
  );

  const gameId = asString(override.gameId, 'scheduleOverride.gameId', 80);
  if (!isValidGameId(gameId)) {
    fail(
      'scheduleOverride.gameId',
      'must be a catalog slug or custom game ID',
    );
  }

  const serverId = asString(
    override.serverId,
    'scheduleOverride.serverId',
    160,
  );
  if (!isValidServerId(gameId, serverId)) {
    fail(
      'scheduleOverride.serverId',
      'must be a valid server ID for the game',
    );
  }

  const expectedId = selectionIdFor(gameId, serverId);
  if (override.id !== expectedId) {
    fail('scheduleOverride.id', `must be \`${expectedId}\``);
  }

  return {
    id: expectedId,
    gameId,
    serverId,
    schedule: parseSchedule(override.schedule),
    updatedAt: asIsoTimestamp(
      override.updatedAt,
      'scheduleOverride.updatedAt',
    ),
  };
}
