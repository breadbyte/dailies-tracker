import type { ScheduleOccurrence } from '../schedule/types.ts';

/**
 * A login completion counts for the current cycle only when it happened at or
 * after the previous schedule occurrence. Completions from earlier cycles stay
 * in history but do not mark the current cycle as done.
 */
export function isCompletionInCurrentCycle(
  completedAt: string | undefined,
  occurrence: ScheduleOccurrence,
): boolean {
  if (completedAt === undefined || occurrence.previousAt === null) return false;
  const parsed = Date.parse(completedAt);
  if (!Number.isFinite(parsed)) return false;
  return parsed >= occurrence.previousAt;
}
