import {
  parseScheduleOverride,
  selectionIdFor,
} from '../../domain/storage/validation.ts';
import type {
  ScheduleOverride,
  ScheduleOverrideInput,
} from '../../domain/storage/types.ts';
import { STORE_NAMES } from './database.ts';
import { StorageError } from './errors.ts';
import { nowIso, type MutationOptions } from './common.ts';
import {
  deleteRecord,
  parseStored,
  putRecord,
  readAllRecords,
  readRecord,
} from './records.ts';

function validateOverride(value: unknown): ScheduleOverride {
  return parseStored(parseScheduleOverride, value, 'Schedule override');
}

function overrideId(input: ScheduleOverrideInput): string {
  try {
    return selectionIdFor(input.gameId, input.serverId);
  } catch (error) {
    throw new StorageError('validation', 'Invalid schedule override ID', {
      cause: error,
    });
  }
}

export async function listScheduleOverrides(): Promise<ScheduleOverride[]> {
  const records = await readAllRecords(STORE_NAMES.scheduleOverrides);
  return records
    .map(validateOverride)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function getScheduleOverride(
  id: string,
): Promise<ScheduleOverride | undefined> {
  const record = await readRecord(STORE_NAMES.scheduleOverrides, id);
  return record === undefined ? undefined : validateOverride(record);
}

export async function setScheduleOverride(
  input: ScheduleOverrideInput,
  options?: MutationOptions,
): Promise<ScheduleOverride> {
  const id = overrideId(input);
  const record: ScheduleOverride = {
    id,
    gameId: input.gameId,
    serverId: input.serverId,
    schedule: input.schedule,
    updatedAt: nowIso(options),
  };

  const validated = validateOverride(record);
  await putRecord(STORE_NAMES.scheduleOverrides, validated);
  return validated;
}

export async function deleteScheduleOverride(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.scheduleOverrides, id);
}
