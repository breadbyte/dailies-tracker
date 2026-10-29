import {
  parseGameSelection,
  selectionIdFor,
} from '../../domain/storage/validation.ts';
import type {
  GameSelection,
  GameSelectionInput,
  GameSelectionUpdate,
} from '../../domain/storage/types.ts';
import { STORE_NAMES } from './database.ts';
import { StorageError } from './errors.ts';
import { nowIso, optionalText, type MutationOptions } from './common.ts';
import {
  deleteRecord,
  parseStored,
  putRecord,
  readAllRecords,
  readRecord,
} from './records.ts';

function selectionId(gameId: string, serverId: string): string {
  try {
    return selectionIdFor(gameId, serverId);
  } catch (error) {
    throw new StorageError('validation', 'Invalid game selection ID', {
      cause: error,
    });
  }
}

function validateSelection(value: unknown): GameSelection {
  return parseStored(parseGameSelection, value, 'Game selection');
}

export async function listGameSelections(): Promise<GameSelection[]> {
  const records = await readAllRecords(STORE_NAMES.selections);
  return records
    .map(validateSelection)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function getGameSelection(
  id: string,
): Promise<GameSelection | undefined> {
  const record = await readRecord(STORE_NAMES.selections, id);
  return record === undefined ? undefined : validateSelection(record);
}

export async function selectGameServer(
  input: GameSelectionInput,
  options?: MutationOptions,
): Promise<GameSelection> {
  const id = selectionId(input.gameId, input.serverId);
  const existing = await getGameSelection(id);
  if (existing !== undefined) return existing;

  const timestamp = nowIso(options);
  const customDisplayName = optionalText(input.customDisplayName);
  const notes = optionalText(input.notes);
  const record: GameSelection = {
    id,
    gameId: input.gameId,
    serverId: input.serverId,
    enabled: input.enabled ?? true,
    ...(customDisplayName === undefined ? {} : { customDisplayName }),
    ...(notes === undefined ? {} : { notes }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const validated = validateSelection(record);
  await putRecord(STORE_NAMES.selections, validated);
  return validated;
}

export async function updateGameSelection(
  id: string,
  patch: GameSelectionUpdate,
  options?: MutationOptions,
): Promise<GameSelection> {
  const existing = await getGameSelection(id);
  if (existing === undefined) {
    throw new StorageError('not-found', `Game selection \`${id}\` does not exist`);
  }

  const next: GameSelection = {
    ...existing,
    enabled: patch.enabled ?? existing.enabled,
    updatedAt: nowIso(options),
  };

  if (patch.customDisplayName !== undefined) {
    const value =
      patch.customDisplayName === null
        ? undefined
        : optionalText(patch.customDisplayName);
    if (value === undefined) {
      delete next.customDisplayName;
    } else {
      next.customDisplayName = value;
    }
  }

  if (patch.notes !== undefined) {
    const value =
      patch.notes === null ? undefined : optionalText(patch.notes);
    if (value === undefined) {
      delete next.notes;
    } else {
      next.notes = value;
    }
  }

  const validated = validateSelection(next);
  await putRecord(STORE_NAMES.selections, validated);
  return validated;
}

export async function removeGameSelection(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.selections, id);
}

export function createGameSelectionId(
  gameId: string,
  serverId: string,
): string {
  return selectionId(gameId, serverId);
}
