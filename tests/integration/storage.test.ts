import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeAppDatabase,
  deleteAppDatabase,
  openAppDatabase,
  STORE_NAMES,
} from '../../src/services/storage/database.ts';
import {
  getGameSelection,
  listGameSelections,
  removeGameSelection,
  selectGameServer,
  updateGameSelection,
} from '../../src/services/storage/selectedGames.ts';
import {
  createCustomGame,
  deleteCustomGame,
  getCustomGame,
  listCustomGames,
  updateCustomGame,
} from '../../src/services/storage/customGames.ts';
import {
  deleteLoginCompletion,
  getLatestLoginCompletion,
  listLoginCompletions,
  recordLoginCompletion,
} from '../../src/services/storage/loginHistory.ts';
import {
  deleteScheduleOverride,
  getScheduleOverride,
  listScheduleOverrides,
  setScheduleOverride,
} from '../../src/services/storage/scheduleOverrides.ts';
import { writeRecords } from '../../src/services/storage/records.ts';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const UUID_C = '00000000-0000-4000-8000-000000000003';
const UUID_D = '00000000-0000-4000-8000-000000000004';
const NOW = '2026-11-01T12:00:00.000Z';

beforeEach(async () => {
  await deleteAppDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
});

function rawGet(storeName: string, key: IDBValidKey): Promise<unknown> {
  return openAppDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

function rawPut(storeName: string, value: unknown): Promise<void> {
  return openAppDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

describe('game selections', () => {
  it('persists selections across database reopen', async () => {
    const selected = await selectGameServer(
      {
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        customDisplayName: '  Alpha  ',
        notes: '  main account  ',
      },
      { now: () => new Date(NOW), randomUUID: () => UUID_A },
    );

    expect(selected).toMatchObject({
      id: 'alpha-game::alpha-game:global',
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      enabled: true,
      customDisplayName: 'Alpha',
      notes: 'main account',
      createdAt: NOW,
      updatedAt: NOW,
    });

    const duplicate = await selectGameServer({
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      enabled: false,
    });
    expect(duplicate).toEqual(selected);

    await closeAppDatabase();
    expect(await listGameSelections()).toEqual([selected]);
  });

  it('updates and removes selections without touching history', async () => {
    const selected = await selectGameServer(
      { gameId: 'alpha-game', serverId: 'alpha-game:global' },
      { now: () => new Date(NOW) },
    );

    const updated = await updateGameSelection(
      selected.id,
      {
        enabled: false,
        customDisplayName: '  Renamed  ',
        notes: null,
      },
      { now: () => new Date('2026-11-02T12:00:00.000Z') },
    );
    expect(updated).toMatchObject({
      enabled: false,
      customDisplayName: 'Renamed',
      createdAt: NOW,
      updatedAt: '2026-11-02T12:00:00.000Z',
    });
    expect(updated.notes).toBeUndefined();

    await removeGameSelection(selected.id);
    expect(await getGameSelection(selected.id)).toBeUndefined();
  });

  it('rejects invalid records before writing', async () => {
    await expect(
      selectGameServer({ gameId: 'Alpha Game', serverId: 'Alpha Game:Global' }),
    ).rejects.toMatchObject({ code: 'validation' });

    const database = await openAppDatabase();
    const count = await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(
        STORE_NAMES.selections,
        'readonly',
      );
      const request = transaction.objectStore(STORE_NAMES.selections).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(count).toBe(0);
  });

  it('surfaces corrupt stored records without deleting them', async () => {
    await rawPut(STORE_NAMES.selections, {
      id: 'bad-record',
      gameId: 'alpha-game',
    });

    await expect(listGameSelections()).rejects.toMatchObject({
      code: 'validation',
    });
    expect(await rawGet(STORE_NAMES.selections, 'bad-record')).toMatchObject({
      id: 'bad-record',
    });
  });
});

describe('custom games', () => {
  it('creates, updates, reloads, and deletes custom games', async () => {
    const created = await createCustomGame(
      {
        name: '  My Game  ',
        menuName: '  MG  ',
        servers: [
          {
            name: 'Global',
            timeZone: 'Europe/Berlin',
            dailyReset: { time: '04:00', basis: 'local' },
          },
          {
            name: 'Asia',
            timeZone: 'Asia/Tokyo',
            dailyReset: { time: '05:00', basis: 'utc' },
          },
        ],
      },
      {
        now: () => new Date(NOW),
        randomUUID: (() => {
          const values = [UUID_A, UUID_B, UUID_C];
          let index = 0;
          return () => values[index++] ?? UUID_D;
        })(),
      },
    );

    expect(created.id).toBe(`custom_${UUID_A}`);
    expect(created.name).toBe('My Game');
    expect(created.menuName).toBe('MG');
    expect(created.servers.map((server) => server.id)).toEqual([
      `custom_${UUID_A}:s_${UUID_B}`,
      `custom_${UUID_A}:s_${UUID_C}`,
    ]);

    const updated = await updateCustomGame(
      created.id,
      {
        name: 'Renamed Game',
        servers: [
          {
            id: created.servers[0]?.id,
            name: 'Europe',
            timeZone: 'Europe/Berlin',
            dailyReset: { time: '06:00', basis: 'local' },
          },
          {
            name: 'Americas',
            timeZone: 'America/New_York',
            dailyReset: { time: '07:00', basis: 'local' },
          },
        ],
      },
      {
        now: () => new Date('2026-11-02T12:00:00.000Z'),
        randomUUID: () => UUID_D,
      },
    );

    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(updated.servers[0]?.id).toBe(created.servers[0]?.id);
    expect(updated.servers[1]?.id).toBe(`custom_${UUID_A}:s_${UUID_D}`);

    await closeAppDatabase();
    expect(await getCustomGame(created.id)).toEqual(updated);
    expect(await listCustomGames()).toEqual([updated]);

    await deleteCustomGame(created.id);
    expect(await getCustomGame(created.id)).toBeUndefined();
  });

  it('rejects custom games with invalid schedules', async () => {
    await expect(
      createCustomGame({
        name: 'Bad Game',
        servers: [
          {
            name: 'Global',
            timeZone: 'Mars/Olympus',
            dailyReset: { time: '04:00', basis: 'local' },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('login completions', () => {
  it('records, filters, finds the latest, and undoes completions', async () => {
    const first = await recordLoginCompletion(
      {
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        completedAt: '2026-11-01T08:00:00.000Z',
        notes: '  daily  ',
      },
      { randomUUID: () => UUID_A },
    );
    const second = await recordLoginCompletion(
      {
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        completedAt: '2026-11-01T09:00:00.000Z',
        taskId: 'daily-login',
      },
      { randomUUID: () => UUID_B },
    );
    await recordLoginCompletion(
      {
        gameId: 'beta-game',
        serverId: 'beta-game:global',
        completedAt: '2026-11-01T10:00:00.000Z',
      },
      { randomUUID: () => UUID_C },
    );

    expect(first.notes).toBe('daily');
    const mine = await listLoginCompletions({
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
    });
    expect(mine.map((entry) => entry.id)).toEqual([UUID_B, UUID_A]);

    const window = await listLoginCompletions({
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      from: '2026-11-01T08:30:00.000Z',
      to: '2026-11-01T09:30:00.000Z',
    });
    expect(window.map((entry) => entry.id)).toEqual([UUID_B]);

    expect(
      await getLatestLoginCompletion('alpha-game', 'alpha-game:global'),
    ).toEqual(second);

    await deleteLoginCompletion(UUID_B);
    expect(
      await listLoginCompletions({
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
      }),
    ).toEqual([first]);
  });

  it('rejects invalid filters and timestamps', async () => {
    await expect(
      listLoginCompletions({ serverId: 'alpha-game:global' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      recordLoginCompletion({
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        completedAt: '2026-11-01T09:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('schedule overrides', () => {
  it('persists, reloads, replaces, and removes a custom schedule', async () => {
    const override = await setScheduleOverride(
      {
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        schedule: {
          kind: 'weekly',
          timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
          time: '05:30',
          weekday: 3,
        },
      },
      { now: () => new Date(NOW) },
    );

    expect(override).toEqual({
      id: 'alpha-game::alpha-game:global',
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      schedule: {
        kind: 'weekly',
        timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
        time: '05:30',
        weekday: 3,
      },
      updatedAt: NOW,
    });

    await closeAppDatabase();
    expect(
      await getScheduleOverride('alpha-game::alpha-game:global'),
    ).toEqual(override);
    expect(await listScheduleOverrides()).toEqual([override]);

    const replaced = await setScheduleOverride(
      {
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        schedule: {
          kind: 'daily',
          timeZone: { kind: 'utc' },
          time: '09:00',
        },
      },
      { now: () => new Date('2026-11-02T12:00:00.000Z') },
    );
    expect(replaced.updatedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(replaced.schedule.kind).toBe('daily');

    await deleteScheduleOverride(replaced.id);
    expect(
      await getScheduleOverride('alpha-game::alpha-game:global'),
    ).toBeUndefined();
  });

  it('rejects schedules and IDs that do not match stored selections', async () => {
    await expect(
      setScheduleOverride({
        gameId: 'alpha-game',
        serverId: 'alpha-game:global',
        schedule: {
          kind: 'daily',
          timeZone: { kind: 'iana', timeZone: 'Mars/Olympus' },
          time: '04:00',
        },
      }),
    ).rejects.toMatchObject({ code: 'validation' });

    const database = await openAppDatabase();
    const count = (): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(
          STORE_NAMES.scheduleOverrides,
          'readonly',
        );
        const request = transaction
          .objectStore(STORE_NAMES.scheduleOverrides)
          .count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    expect(await count()).toBe(0);

    await rawPut(STORE_NAMES.scheduleOverrides, {
      id: 'alpha-game::beta-game:global',
      gameId: 'alpha-game',
      serverId: 'beta-game:global',
      schedule: {
        kind: 'daily',
        timeZone: { kind: 'utc' },
        time: '04:00',
      },
      updatedAt: NOW,
    });
    await expect(listScheduleOverrides()).rejects.toMatchObject({
      code: 'validation',
    });
    expect(await count()).toBe(1);
  });
});

describe('multi-store writes', () => {
  it('rolls back every write when one record cannot be stored', async () => {
    const selection = {
      id: 'alpha-game::alpha-game:global',
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await rawPut(STORE_NAMES.selections, selection);

    await expect(
      writeRecords({
        clear: [STORE_NAMES.selections],
        put: [
          { store: STORE_NAMES.selections, value: selection },
          {
            store: STORE_NAMES.customGames,
            value: () => undefined,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'transaction-failed' });

    expect(await rawGet(STORE_NAMES.selections, selection.id)).toMatchObject({
      id: selection.id,
    });
  });
});

describe('database lifecycle', () => {
  it('migrates version 1 data without losing selections', async () => {
    await deleteAppDatabase();
    const selection = {
      id: 'alpha-game::alpha-game:global',
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('dailies', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('gameSelections', {
          keyPath: 'id',
        });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          'gameSelections',
          'readwrite',
        );
        transaction
          .objectStore('gameSelections')
          .put(selection);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const database = await openAppDatabase();
    expect(database.version).toBe(3);
    expect(await listGameSelections()).toEqual([selection]);
  });

  it('rejects a database created by a newer app version', async () => {
    await deleteAppDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('dailies', 4);
      request.onupgradeneeded = () => undefined;
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    await expect(openAppDatabase()).rejects.toMatchObject({
      code: 'unsupported-version',
    });
  });

  it('maps a blocked browser factory to an unavailable error', async () => {
    const factory = {
      open() {
        throw Object.assign(new Error('denied'), { name: 'SecurityError' });
      },
    } as unknown as IDBFactory;

    await expect(openAppDatabase(factory)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
