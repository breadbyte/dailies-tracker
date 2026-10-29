/**
 * Builds a GitHub-style login calendar from local completion history.
 *
 * Counts are distinct games with at least one recorded login on a local
 * calendar day. The grid ends with the current week (Sunday through Saturday)
 * and contains 53 columns, matching GitHub's contribution calendar.
 */

export const HEATMAP_WEEKS = 53;
export const HEATMAP_LEVELS = 4;

export interface HeatmapCompletion {
  completedAt: string;
  gameId: string;
}

export interface HeatmapDay {
  /** Local calendar date as `YYYY-MM-DD`. */
  key: string;
  date: Date;
  count: number;
  level: number;
  future: boolean;
}

export interface HeatmapWeek {
  days: HeatmapDay[];
  /** Short month label for the first week that contains a month start. */
  monthLabel?: string;
}

export interface LoginHeatmap {
  weeks: HeatmapWeek[];
  /** Number of days with at least one recorded game login. */
  activeDays: number;
  /** Total distinct game-days in the displayed range. */
  totalGames: number;
  maxGamesInDay: number;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Maps a count of distinct games to one of GitHub's five intensity levels. */
export function heatmapLevel(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function gamesByDay(
  completions: readonly HeatmapCompletion[],
): Map<string, Set<string>> {
  const counts = new Map<string, Set<string>>();
  for (const completion of completions) {
    const completedAt = Date.parse(completion.completedAt);
    if (!Number.isFinite(completedAt)) continue;
    const key = dayKey(new Date(completedAt));
    const games = counts.get(key);
    if (games === undefined) {
      counts.set(key, new Set([completion.gameId]));
    } else {
      games.add(completion.gameId);
    }
  }
  return counts;
}

export function buildLoginHeatmap(
  completions: readonly HeatmapCompletion[],
  now: Date,
  locale?: string,
): LoginHeatmap {
  const today = startOfLocalDay(now);
  const end = addDays(today, 6 - today.getDay());
  const start = addDays(end, -(HEATMAP_WEEKS * 7 - 1));
  const counts = gamesByDay(completions);
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
  });

  const weeks: HeatmapWeek[] = [];
  let activeDays = 0;
  let totalGames = 0;
  let maxGamesInDay = 0;
  let previousMonth: number | undefined;

  for (let weekIndex = 0; weekIndex < HEATMAP_WEEKS; weekIndex += 1) {
    const days: HeatmapDay[] = [];
    let monthLabel: string | undefined;

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = addDays(start, weekIndex * 7 + dayIndex);
      const key = dayKey(date);
      const count = counts.get(key)?.size ?? 0;
      const future = date.getTime() > today.getTime();

      if (!future) {
        if (count > 0) activeDays += 1;
        totalGames += count;
        maxGamesInDay = Math.max(maxGamesInDay, count);
      }

      days.push({
        key,
        date,
        count,
        level: future ? 0 : heatmapLevel(count),
        future,
      });

      if (monthLabel === undefined) {
        const month = date.getMonth();
        if (month !== previousMonth) {
          monthLabel = monthFormatter.format(date);
          previousMonth = month;
        }
      }
    }

    weeks.push(monthLabel === undefined ? { days } : { days, monthLabel });
  }

  return { weeks, activeDays, totalGames, maxGamesInDay };
}
