import {
  customGameIdFromUuid,
  customServerIdFromUuid,
  parseCustomGame,
} from '../../domain/storage/validation.ts';
import type {
  CustomGameDraft,
  CustomGameRecord,
} from '../../domain/storage/types.ts';
import { STORE_NAMES } from './database.ts';
import { StorageError } from './errors.ts';
import { nextUuid, nowIso, optionalText, type MutationOptions } from './common.ts';
import {
  deleteRecord,
  parseStored,
  putRecord,
  readAllRecords,
  readRecord,
} from './records.ts';

function validateCustomGame(value: unknown): CustomGameRecord {
  return parseStored(parseCustomGame, value, 'Custom game');
}

function customGameId(options?: MutationOptions): string {
  try {
    return customGameIdFromUuid(nextUuid(options));
  } catch (error) {
    throw new StorageError('validation', 'Invalid custom game ID', {
      cause: error,
    });
  }
}

function customServerId(gameId: string, options?: MutationOptions): string {
  try {
    return customServerIdFromUuid(gameId, nextUuid(options));
  } catch (error) {
    throw new StorageError('validation', 'Invalid custom server ID', {
      cause: error,
    });
  }
}

export async function listCustomGames(): Promise<CustomGameRecord[]> {
  const records = await readAllRecords(STORE_NAMES.customGames);
  return records
    .map(validateCustomGame)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function getCustomGame(
  id: string,
): Promise<CustomGameRecord | undefined> {
  const record = await readRecord(STORE_NAMES.customGames, id);
  return record === undefined ? undefined : validateCustomGame(record);
}

export async function createCustomGame(
  draft: CustomGameDraft,
  options?: MutationOptions,
): Promise<CustomGameRecord> {
  const id = customGameId(options);
  const timestamp = nowIso(options);
  const menuName = optionalText(draft.menuName);
  const servers = draft.servers.map((server) => ({
    id: server.id ?? customServerId(id, options),
    name: server.name.trim(),
    timeZone: server.timeZone,
    dailyReset: {
      time: server.dailyReset.time,
      basis: server.dailyReset.basis,
    },
  }));
  const record: CustomGameRecord = {
    id,
    name: draft.name.trim(),
    ...(menuName === undefined ? {} : { menuName }),
    servers,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const validated = validateCustomGame(record);
  await putRecord(STORE_NAMES.customGames, validated);
  return validated;
}

export async function updateCustomGame(
  id: string,
  draft: CustomGameDraft,
  options?: MutationOptions,
): Promise<CustomGameRecord> {
  const existing = await getCustomGame(id);
  if (existing === undefined) {
    throw new StorageError('not-found', `Custom game \`${id}\` does not exist`);
  }

  const menuName = optionalText(draft.menuName);
  const servers = draft.servers.map((server) => ({
    id: server.id ?? customServerId(id, options),
    name: server.name.trim(),
    timeZone: server.timeZone,
    dailyReset: {
      time: server.dailyReset.time,
      basis: server.dailyReset.basis,
    },
  }));
  const record: CustomGameRecord = {
    id,
    name: draft.name.trim(),
    ...(menuName === undefined ? {} : { menuName }),
    servers,
    createdAt: existing.createdAt,
    updatedAt: nowIso(options),
  };

  const validated = validateCustomGame(record);
  await putRecord(STORE_NAMES.customGames, validated);
  return validated;
}

export async function deleteCustomGame(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.customGames, id);
}
