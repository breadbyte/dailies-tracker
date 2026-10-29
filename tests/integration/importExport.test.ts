import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_CATEGORIES,
  type BackupFile,
} from '../../src/domain/backup/types.ts';
import { createDefaultPreferences } from '../../src/domain/storage/validation.ts';
import {
  createBackupFile,
  serializeBackup,
} from '../../src/services/import-export/exportBackup.ts';
import {
  applyBackupImport,
  MAX_BACKUP_FILE_BYTES,
  parseBackupText,
  previewBackupImport,
  readBackupFile,
} from '../../src/services/import-export/importBackup.ts';
import {
  closeAppDatabase,
  deleteAppDatabase,
} from '../../src/services/storage/database.ts';
import {
  createCustomGame,
  listCustomGames,
} from '../../src/services/storage/customGames.ts';
import {
  listAllLoginCompletions,
  recordLoginCompletion,
} from '../../src/services/storage/loginHistory.ts';
import {
  loadPreferences,
  savePreferences,
} from '../../src/services/storage/preferences.ts';
import {
  listScheduleOverrides,
  setScheduleOverride,
} from '../../src/services/storage/scheduleOverrides.ts';
import {
  listGameSelections,
  selectGameServer,
} from '../../src/services/storage/selectedGames.ts';

function fixture(name: string): BackupFile {
  return parseBackupText(
    readFileSync(`tests/fixtures/backups/${name}`, 'utf8'),
  );
}

async function seedLocalData() {
  await selectGameServer({
    gameId: 'afk-arena',
    serverId: 'afk-arena:global',
    customDisplayName: 'Local AFK',
  });
  await createCustomGame({
    name: 'Local Custom Game',
    servers: [
      {
        name: 'Global',
        timeZone: 'Europe/Berlin',
        dailyReset: { time: '04:00', basis: 'local' },
      },
    ],
  });
  await setScheduleOverride({
    gameId: 'afk-arena',
    serverId: 'afk-arena:global',
    schedule: {
      kind: 'weekly',
      timeZone: { kind: 'utc' },
      time: '06:00',
      weekday: 4,
    },
  });
  await recordLoginCompletion({
    gameId: 'afk-arena',
    serverId: 'afk-arena:global',
    completedAt: '2026-09-05T08:00:00.000Z',
  });
  savePreferences({
    ...createDefaultPreferences(),
    theme: 'dark',
    displayTimeZone: 'Europe/Berlin',
  });
}

beforeEach(async () => {
  await deleteAppDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await closeAppDatabase();
});

describe('backup export', () => {
  it('round-trips every local category into a fresh profile', async () => {
    await seedLocalData();
    const originalSelections = await listGameSelections();
    const originalCustomGames = await listCustomGames();
    const originalOverrides = await listScheduleOverrides();
    const originalCompletions = await listAllLoginCompletions();

    const backup = await createBackupFile({
      now: () => new Date('2026-10-01T12:00:00.000Z'),
    });

    expect(backup.exportedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(backup.data.selectedGames).toEqual(originalSelections);
    expect(backup.data.customGames).toEqual(originalCustomGames);
    expect(backup.data.gameSchedules).toEqual(originalOverrides);
    expect(backup.data.loginCompletionHistory).toEqual(originalCompletions);

    const serialized = serializeBackup(backup);
    expect(serialized).not.toMatch(
      /password|token|secret|credential|subscription|encryption/i,
    );

    const restored = parseBackupText(serialized);
    await deleteAppDatabase();
    window.localStorage.clear();
    await applyBackupImport(restored, {
      mode: 'replace',
      categories: [...BACKUP_CATEGORIES],
    });

    expect(await listGameSelections()).toEqual(originalSelections);
    expect(await listCustomGames()).toEqual(originalCustomGames);
    expect(await listScheduleOverrides()).toEqual(originalOverrides);
    expect(await listAllLoginCompletions()).toEqual(originalCompletions);
    expect(loadPreferences().preferences).toEqual(backup.data.preferences);
  });

  it('previews merge conflicts without writing', async () => {
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
      customDisplayName: 'Newer local name',
    });

    const backup = fixture('schema-v1.json');
    const preview = await previewBackupImport(backup, {
      mode: 'merge',
      categories: ['selectedGames'],
    });

    expect(preview.counts.selectedGames.skipped).toBe(1);
    expect(await listGameSelections()).toHaveLength(1);
    expect((await listGameSelections())[0]?.customDisplayName).toBe(
      'Newer local name',
    );
  });
});

describe('backup import validation', () => {
  it('rejects malformed, future, and oversized input without changing data', async () => {
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
    });

    expect(() => parseBackupText('{not json')).toThrow(/not valid JSON/);
    await expect(
      readBackupFile(new File(['{"format":"nope"}'], 'bad.json')),
    ).rejects.toMatchObject({ code: 'invalid-backup' });
    expect(() =>
      parseBackupText(
        readFileSync('tests/fixtures/backups/schema-v2-future.json', 'utf8'),
      ),
    ).toThrow(/newer version/);
    expect(() => parseBackupText('x'.repeat(MAX_BACKUP_FILE_BYTES + 1))).toThrow(
      /larger than/,
    );

    expect(await listGameSelections()).toHaveLength(1);
  });

  it('replaces only the categories selected by the user', async () => {
    await seedLocalData();
    const existingSelections = await listGameSelections();

    await applyBackupImport(fixture('schema-v1.json'), {
      mode: 'replace',
      categories: ['loginCompletionHistory'],
    });

    expect(await listGameSelections()).toEqual(existingSelections);
    expect(await listAllLoginCompletions()).toHaveLength(1);
    expect((await listAllLoginCompletions())[0]?.notes).toBe('fixture login');
  });
});
