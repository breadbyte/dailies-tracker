import {
  isValidGameId,
  isValidServerId,
  parseLoginCompletion,
  parseStorageTimestamp,
} from '../../domain/storage/validation.ts';
import type {
  LoginCompletion,
  LoginCompletionFilter,
  LoginCompletionInput,
} from '../../domain/storage/types.ts';
import { STORE_NAMES } from './database.ts';
import { StorageError } from './errors.ts';
import { nextUuid, nowIso, optionalText, type MutationOptions } from './common.ts';
import {
  deleteRecord,
  getKeyRange,
  parseStored,
  putRecord,
  readAllRecords,
} from './records.ts';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function validateCompletion(value: unknown): LoginCompletion {
  return parseStored(parseLoginCompletion, value, 'Login completion');
}

function validatedTimestamp(value: unknown, path: string): string {
  try {
    return parseStorageTimestamp(value, path);
  } catch (error) {
    throw new StorageError('validation', `Invalid ${path}`, { cause: error });
  }
}

function validatedFilter(
  filter: LoginCompletionFilter,
): Required<Pick<LoginCompletionFilter, 'limit'>> &
  Omit<LoginCompletionFilter, 'limit'> {
  if (filter.serverId !== undefined && filter.gameId === undefined) {
    throw new StorageError(
      'validation',
      'A game ID is required when filtering by server ID',
    );
  }
  if (filter.gameId !== undefined && !isValidGameId(filter.gameId)) {
    throw new StorageError('validation', 'Invalid game ID filter');
  }
  if (
    filter.gameId !== undefined &&
    filter.serverId !== undefined &&
    !isValidServerId(filter.gameId, filter.serverId)
  ) {
    throw new StorageError('validation', 'Invalid server ID filter');
  }

  const from =
    filter.from === undefined
      ? undefined
      : validatedTimestamp(filter.from, 'from');
  const to =
    filter.to === undefined ? undefined : validatedTimestamp(filter.to, 'to');
  if (from !== undefined && to !== undefined && from > to) {
    throw new StorageError('validation', 'The from time must not exceed the to time');
  }

  const limit = filter.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new StorageError(
      'validation',
      `The limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }

  return {
    ...(filter.gameId === undefined ? {} : { gameId: filter.gameId }),
    ...(filter.serverId === undefined
      ? {}
      : { serverId: filter.serverId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    limit,
  };
}

export async function recordLoginCompletion(
  input: LoginCompletionInput,
  options?: MutationOptions,
): Promise<LoginCompletion> {
  const taskId = optionalText(input.taskId);
  const notes = optionalText(input.notes);
  const record: LoginCompletion = {
    id: nextUuid(options),
    gameId: input.gameId,
    serverId: input.serverId,
    completedAt: input.completedAt ?? nowIso(options),
    ...(taskId === undefined ? {} : { taskId }),
    ...(notes === undefined ? {} : { notes }),
  };

  const validated = validateCompletion(record);
  await putRecord(STORE_NAMES.loginCompletions, validated);
  return validated;
}

export async function listLoginCompletions(
  filter: LoginCompletionFilter = {},
): Promise<LoginCompletion[]> {
  const normalized = validatedFilter(filter);
  const keyRange = getKeyRange();
  let records: unknown[];

  if (normalized.gameId !== undefined && normalized.serverId !== undefined) {
    records = await readAllRecords(STORE_NAMES.loginCompletions, {
      index: 'gameServerCompletedAt',
      query: keyRange.bound(
        [
          normalized.gameId,
          normalized.serverId,
          normalized.from ?? '',
        ],
        [
          normalized.gameId,
          normalized.serverId,
          normalized.to ?? '\uffff',
        ],
      ),
    });
  } else if (normalized.gameId !== undefined) {
    records = await readAllRecords(STORE_NAMES.loginCompletions, {
      index: 'gameId',
      query: normalized.gameId,
    });
  } else if (normalized.from !== undefined && normalized.to !== undefined) {
    records = await readAllRecords(STORE_NAMES.loginCompletions, {
      index: 'completedAt',
      query: keyRange.bound(normalized.from, normalized.to),
    });
  } else if (normalized.from !== undefined) {
    records = await readAllRecords(STORE_NAMES.loginCompletions, {
      index: 'completedAt',
      query: keyRange.lowerBound(normalized.from),
    });
  } else if (normalized.to !== undefined) {
    records = await readAllRecords(STORE_NAMES.loginCompletions, {
      index: 'completedAt',
      query: keyRange.upperBound(normalized.to),
    });
  } else {
    records = await readAllRecords(STORE_NAMES.loginCompletions, {
      index: 'completedAt',
    });
  }

  return records
    .map(validateCompletion)
    .filter(
      (record) =>
        (normalized.gameId === undefined ||
          record.gameId === normalized.gameId) &&
        (normalized.serverId === undefined ||
          record.serverId === normalized.serverId) &&
        (normalized.from === undefined ||
          record.completedAt >= normalized.from) &&
        (normalized.to === undefined || record.completedAt <= normalized.to),
    )
    .sort(
      (a, b) =>
        b.completedAt.localeCompare(a.completedAt) ||
        b.id.localeCompare(a.id),
    )
    .slice(0, normalized.limit);
}

/** Returns the complete completion history, newest first, for backups. */
export async function listAllLoginCompletions(): Promise<LoginCompletion[]> {
  const records = await readAllRecords(STORE_NAMES.loginCompletions, {
    index: 'completedAt',
  });
  return records
    .map(validateCompletion)
    .sort(
      (a, b) =>
        b.completedAt.localeCompare(a.completedAt) ||
        b.id.localeCompare(a.id),
    );
}

export async function getLatestLoginCompletion(
  gameId: string,
  serverId: string,
): Promise<LoginCompletion | undefined> {  const records = await listLoginCompletions({
    gameId,
    serverId,
    limit: 1,
  });
  return records[0];
}

export async function deleteLoginCompletion(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.loginCompletions, id);
}
