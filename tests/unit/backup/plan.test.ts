import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BackupPlanError,
  planBackupImport,
} from '../../../src/domain/backup/plan.ts';
import type { BackupData } from '../../../src/domain/backup/types.ts';
import { parseBackupFile } from '../../../src/domain/backup/validation.ts';

function baseData(): BackupData {
  const document = JSON.parse(
    readFileSync('tests/fixtures/backups/schema-v1.json', 'utf8'),
  ) as unknown;
  return parseBackupFile(document).data;
}

function selection(
  id: string,
  updatedAt: string,
  enabled = true,
): BackupData['selectedGames'][number] {
  const [gameId, serverId] = id.split('::');
  return {
    id,
    gameId: gameId ?? 'afk-arena',
    serverId: serverId ?? 'afk-arena:global',
    enabled,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('backup import planning', () => {
  it('merges by stable ID with the newer updatedAt winning', () => {
    const existing: BackupData = {
      ...baseData(),
      selectedGames: [
        selection('afk-arena::afk-arena:global', '2026-01-02T00:00:00.000Z'),
        selection('beta-game::beta-game:global', '2026-01-05T00:00:00.000Z'),
      ],
    };
    const incoming: BackupData = {
      ...baseData(),
      selectedGames: [
        selection(
          'afk-arena::afk-arena:global',
          '2026-01-01T00:00:00.000Z',
          false,
        ),
        selection(
          'beta-game::beta-game:global',
          '2026-01-06T00:00:00.000Z',
          false,
        ),
        selection('gamma-game::gamma-game:global', '2026-01-01T00:00:00.000Z'),
      ],
    };

    const plan = planBackupImport(existing, incoming, {
      mode: 'merge',
      categories: ['selectedGames'],
    }, { hasSavedPreferences: true });

    expect(plan.preview.counts.selectedGames).toEqual({
      incoming: 3,
      added: 1,
      updated: 1,
      skipped: 1,
      removed: 0,
    });
    expect(
      plan.resulting.selectedGames.find(
        (record) => record.id === 'afk-arena::afk-arena:global',
      )?.enabled,
    ).toBe(true);
    expect(
      plan.resulting.selectedGames.find(
        (record) => record.id === 'beta-game::beta-game:global',
      )?.enabled,
    ).toBe(false);
    expect(plan.resulting.selectedGames).toHaveLength(3);
    expect(plan.writes.selectedGames?.map((record) => record.id)).toEqual([
      'beta-game::beta-game:global',
      'gamma-game::gamma-game:global',
    ]);
    expect(plan.preview.warnings.join(' ')).toMatch(/kept because/);
  });

  it('keeps saved local preferences during merge but applies them to a fresh profile', () => {
    const existing = baseData();
    const incoming: BackupData = {
      ...baseData(),
      preferences: { ...baseData().preferences, theme: 'light' },
    };

    const kept = planBackupImport(existing, incoming, {
      mode: 'merge',
      categories: ['preferences'],
    }, { hasSavedPreferences: true });
    expect(kept.resulting.preferences.theme).toBe('dark');
    expect(kept.replacePreferences).toBe(false);
    expect(kept.preview.counts.preferences.skipped).toBe(1);

    const fresh = planBackupImport(existing, incoming, {
      mode: 'merge',
      categories: ['preferences'],
    }, { hasSavedPreferences: false });
    expect(fresh.resulting.preferences.theme).toBe('light');
    expect(fresh.replacePreferences).toBe(true);
    expect(fresh.preview.counts.preferences.added).toBe(1);
  });

  it('deduplicates completion history by ID instead of rewriting it', () => {
    const existing = baseData();
    const completion = existing.loginCompletionHistory[0];
    expect(completion).toBeDefined();
    const incoming: BackupData = {
      ...baseData(),
      loginCompletionHistory: [
        { ...completion!, notes: 'imported copy' },
        {
          id: '44444444-4444-4444-8444-444444444444',
          gameId: 'afk-arena',
          serverId: 'afk-arena:global',
          completedAt: '2026-09-06T08:00:00.000Z',
        },
      ],
    };

    const plan = planBackupImport(existing, incoming, {
      mode: 'merge',
      categories: ['loginCompletionHistory'],
    }, { hasSavedPreferences: true });

    expect(plan.preview.counts.loginCompletionHistory).toEqual({
      incoming: 2,
      added: 1,
      updated: 0,
      skipped: 1,
      removed: 0,
    });
    expect(plan.resulting.loginCompletionHistory).toHaveLength(2);
    expect(plan.resulting.loginCompletionHistory[0]?.notes).toBe(
      'fixture login',
    );
  });

  it('replaces only selected categories and keeps the rest', () => {
    const existing = baseData();
    const incoming: BackupData = {
      ...baseData(),
      selectedGames: [
        selection('beta-game::beta-game:global', '2026-02-01T00:00:00.000Z'),
      ],
      customGames: [],
      loginCompletionHistory: [],
    };

    const plan = planBackupImport(existing, incoming, {
      mode: 'replace',
      categories: ['selectedGames'],
    }, { hasSavedPreferences: true });

    expect(plan.resulting.selectedGames.map((record) => record.id)).toEqual([
      'beta-game::beta-game:global',
    ]);
    expect(plan.resulting.customGames).toEqual(existing.customGames);
    expect(plan.resulting.loginCompletionHistory).toEqual(
      existing.loginCompletionHistory,
    );
    expect(plan.clearCategories).toEqual(['selectedGames']);
    expect(plan.preview.counts.selectedGames).toEqual({
      incoming: 1,
      added: 1,
      updated: 0,
      skipped: 0,
      removed: 2,
    });
    expect(plan.preview.warnings.join(' ')).toMatch(/will be replaced/);
  });

  it('rejects an empty category selection', () => {
    expect(() =>
      planBackupImport(baseData(), baseData(), {
        mode: 'merge',
        categories: [],
      }, { hasSavedPreferences: true }),
    ).toThrow(BackupPlanError);
  });
});
