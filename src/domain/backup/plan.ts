import { isCustomGameId } from '../storage/validation.ts';
import {
  BACKUP_CATEGORIES,
  type BackupCategory,
  type BackupCategoryCounts,
  type BackupCategorySummary,
  type BackupData,
  type ImportContext,
  type ImportOptions,
  type ImportPlan,
  type ImportWrites,
} from './types.ts';

export class BackupPlanError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'BackupPlanError';
    this.path = path;
  }
}

function emptyCounts(): BackupCategoryCounts {
  return { incoming: 0, added: 0, updated: 0, skipped: 0, removed: 0 };
}

function emptySummary(): BackupCategorySummary {
  return {
    preferences: emptyCounts(),
    selectedGames: emptyCounts(),
    customGames: emptyCounts(),
    gameSchedules: emptyCounts(),
    loginCompletionHistory: emptyCounts(),
  };
}

function normalizeCategories(
  categories: readonly BackupCategory[],
): BackupCategory[] {
  const selected = new Set<BackupCategory>();
  for (const category of categories) {
    if (!BACKUP_CATEGORIES.includes(category)) {
      throw new BackupPlanError(
        'categories',
        `unknown backup category \`${String(category)}\``,
      );
    }
    selected.add(category);
  }
  if (selected.size === 0) {
    throw new BackupPlanError('categories', 'select at least one category');
  }
  return BACKUP_CATEGORIES.filter((category) => selected.has(category));
}

function totalRecordCounts(
  counts: BackupCategorySummary,
  key: keyof BackupCategoryCounts,
): number {
  return BACKUP_CATEGORIES.reduce(
    (sum, category) =>
      category === 'preferences' ? sum : sum + counts[category][key],
    0,
  );
}

interface MergedRecords<T> {
  records: T[];
  changed: T[];
  added: number;
  updated: number;
  skipped: number;
}

/**
 * Merges records identified by stable ID. The newer `updatedAt` wins, and an
 * equal timestamp keeps the local record. Ties therefore always preserve the
 * existing profile's edit.
 */
function mergeTimestamped<T extends { id: string; updatedAt: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): MergedRecords<T> {
  const byId = new Map(existing.map((record) => [record.id, record]));
  const changed: T[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const record of incoming) {
    const current = byId.get(record.id);
    if (current === undefined) {
      byId.set(record.id, record);
      changed.push(record);
      added += 1;
    } else if (record.updatedAt > current.updatedAt) {
      byId.set(record.id, record);
      changed.push(record);
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    records: Array.from(byId.values()),
    changed,
    added,
    updated,
    skipped,
  };
}

/**
 * Completion history is append-only. A record with a known ID is never
 * rewritten, so importing the same backup twice cannot duplicate history.
 */
function mergeCompletions<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): MergedRecords<T> {
  const records = [...existing];
  const changed: T[] = [];
  const seen = new Set(existing.map((record) => record.id));
  let added = 0;
  let skipped = 0;

  for (const record of incoming) {
    if (seen.has(record.id)) {
      skipped += 1;
      continue;
    }
    seen.add(record.id);
    records.push(record);
    changed.push(record);
    added += 1;
  }

  return { records, changed, added, updated: 0, skipped };
}

function planPreferences(
  existing: BackupData['preferences'],
  incoming: BackupData['preferences'],
  options: ImportOptions,
  context: ImportContext,
): {
  value: BackupData['preferences'];
  counts: BackupCategoryCounts;
  replace: boolean;
} {
  if (options.mode === 'replace') {
    return {
      value: incoming,
      counts: {
        incoming: 1,
        added: 1,
        updated: 0,
        skipped: 0,
        removed: context.hasSavedPreferences ? 1 : 0,
      },
      replace: true,
    };
  }

  if (context.hasSavedPreferences) {
    return {
      value: existing,
      counts: {
        incoming: 1,
        added: 0,
        updated: 0,
        skipped: 1,
        removed: 0,
      },
      replace: false,
    };
  }

  return {
    value: incoming,
    counts: {
      incoming: 1,
      added: 1,
      updated: 0,
      skipped: 0,
      removed: 0,
    },
    replace: true,
  };
}

function planMergeRecords<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
  counts: BackupCategoryCounts,
  merge: () => MergedRecords<T>,
): MergedRecords<T> {
  counts.incoming = incoming.length;
  counts.removed = 0;
  const merged = merge();
  counts.added = merged.added;
  counts.updated = merged.updated;
  counts.skipped = merged.skipped;
  return merged;
}

function planReplaceRecords<T>(
  existing: readonly T[],
  incoming: readonly T[],
  counts: BackupCategoryCounts,
): T[] {
  counts.incoming = incoming.length;
  counts.added = incoming.length;
  counts.updated = 0;
  counts.skipped = 0;
  counts.removed = existing.length;
  return [...incoming];
}

export function planBackupImport(
  existing: BackupData,
  incoming: BackupData,
  options: ImportOptions,
  context: ImportContext,
): ImportPlan {
  if (options.mode !== 'merge' && options.mode !== 'replace') {
    throw new BackupPlanError(
      'mode',
      'must be `merge` or `replace`',
    );
  }

  const categories = normalizeCategories(options.categories);
  const counts = emptySummary();
  const resulting: BackupData = {
    preferences: existing.preferences,
    selectedGames: [...existing.selectedGames],
    customGames: [...existing.customGames],
    gameSchedules: [...existing.gameSchedules],
    loginCompletionHistory: [...existing.loginCompletionHistory],
  };
  const warnings: string[] = [];
  const writes: ImportWrites = {};
  let replacePreferences = false;

  if (categories.includes('preferences')) {
    const planned = planPreferences(
      existing.preferences,
      incoming.preferences,
      options,
      context,
    );
    resulting.preferences = planned.value;
    counts.preferences = planned.counts;
    replacePreferences = planned.replace;
  }

  if (categories.includes('selectedGames')) {
    if (options.mode === 'merge') {
      const merged = planMergeRecords(
        existing.selectedGames,
        incoming.selectedGames,
        counts.selectedGames,
        () => mergeTimestamped(existing.selectedGames, incoming.selectedGames),
      );
      resulting.selectedGames = merged.records;
      writes.selectedGames = merged.changed;
    } else {
      resulting.selectedGames = planReplaceRecords(
        existing.selectedGames,
        incoming.selectedGames,
        counts.selectedGames,
      );
      writes.selectedGames = resulting.selectedGames;
    }
  }

  if (categories.includes('customGames')) {
    if (options.mode === 'merge') {
      const merged = planMergeRecords(
        existing.customGames,
        incoming.customGames,
        counts.customGames,
        () => mergeTimestamped(existing.customGames, incoming.customGames),
      );
      resulting.customGames = merged.records;
      writes.customGames = merged.changed;
    } else {
      resulting.customGames = planReplaceRecords(
        existing.customGames,
        incoming.customGames,
        counts.customGames,
      );
      writes.customGames = resulting.customGames;
    }
  }

  if (categories.includes('gameSchedules')) {
    if (options.mode === 'merge') {
      const merged = planMergeRecords(
        existing.gameSchedules,
        incoming.gameSchedules,
        counts.gameSchedules,
        () => mergeTimestamped(existing.gameSchedules, incoming.gameSchedules),
      );
      resulting.gameSchedules = merged.records;
      writes.gameSchedules = merged.changed;
    } else {
      resulting.gameSchedules = planReplaceRecords(
        existing.gameSchedules,
        incoming.gameSchedules,
        counts.gameSchedules,
      );
      writes.gameSchedules = resulting.gameSchedules;
    }
  }

  if (categories.includes('loginCompletionHistory')) {
    if (options.mode === 'merge') {
      const merged = planMergeRecords(
        existing.loginCompletionHistory,
        incoming.loginCompletionHistory,
        counts.loginCompletionHistory,
        () =>
          mergeCompletions(
            existing.loginCompletionHistory,
            incoming.loginCompletionHistory,
          ),
      );
      resulting.loginCompletionHistory = merged.records;
      writes.loginCompletionHistory = merged.changed;
    } else {
      resulting.loginCompletionHistory = planReplaceRecords(
        existing.loginCompletionHistory,
        incoming.loginCompletionHistory,
        counts.loginCompletionHistory,
      );
      writes.loginCompletionHistory = resulting.loginCompletionHistory;
    }
  }

  const customGameIds = new Set(
    resulting.customGames.map((game) => game.id),
  );
  const missingCustomGames = [
    ...resulting.selectedGames,
    ...resulting.gameSchedules,
    ...resulting.loginCompletionHistory,
  ].filter(
    (record) =>
      isCustomGameId(record.gameId) && !customGameIds.has(record.gameId),
  ).length;
  if (missingCustomGames > 0) {
    warnings.push(
      `${missingCustomGames} saved ${
        missingCustomGames === 1 ? 'record refers' : 'records refer'
      } to a custom game that is not present in this backup.`,
    );
  }

  const skipped = totalRecordCounts(counts, 'skipped');
  if (options.mode === 'merge' && skipped > 0) {
    warnings.push(
      `${skipped} existing ${
        skipped === 1 ? 'record was' : 'records were'
      } kept because it was the same age or newer than the imported copy.`,
    );
  }

  if (options.mode === 'merge' && context.hasSavedPreferences && categories.includes('preferences')) {
    warnings.push(
      'Local preferences were kept. Use replace mode to copy imported preferences.',
    );
  }

  const removed = totalRecordCounts(counts, 'removed');
  if (options.mode === 'replace' && removed > 0) {
    warnings.push(
      `${removed} existing ${
        removed === 1 ? 'record' : 'records'
      } in the selected categories will be replaced.`,
    );
  }

  return {
    preview: {
      mode: options.mode,
      categories,
      counts,
      warnings,
    },
    resulting,
    writes,
    clearCategories:
      options.mode === 'replace'
        ? categories.filter((category) => category !== 'preferences')
        : [],
    replacePreferences,
  };
}
