import { describe, expect, it } from 'vitest';
import {
  buildLoginHeatmap,
  heatmapLevel,
} from '../../../src/domain/tracking/heatmap.ts';

function completion(day: number, gameId: string, hour = 12) {
  return {
    gameId,
    completedAt: new Date(2026, 9, day, hour).toISOString(),
  };
}

function findDay(
  heatmap: ReturnType<typeof buildLoginHeatmap>,
  key: string,
) {
  return heatmap.weeks
    .flatMap((week) => week.days)
    .find((day) => day.key === key);
}

describe('login heatmap', () => {
  it('counts distinct games per local day', () => {
    const now = new Date(2026, 9, 29, 12);
    const heatmap = buildLoginHeatmap(
      [
        completion(29, 'afk-arena'),
        completion(29, 'afk-arena', 18),
        completion(29, 'arknights'),
        completion(28, 'arknights'),
        completion(27, 'alpha'),
        completion(27, 'beta'),
        completion(27, 'gamma'),
        completion(27, 'delta'),
        { gameId: 'bad', completedAt: 'not-a-date' },
      ],
      now,
      'en-US',
    );

    expect(heatmap.weeks).toHaveLength(53);
    expect(heatmap.weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(heatmap.activeDays).toBe(3);
    expect(heatmap.totalGames).toBe(7);
    expect(heatmap.maxGamesInDay).toBe(4);

    expect(findDay(heatmap, '2026-10-29')?.count).toBe(2);
    expect(findDay(heatmap, '2026-10-29')?.level).toBe(2);
    expect(findDay(heatmap, '2026-10-28')?.count).toBe(1);
    expect(findDay(heatmap, '2026-10-27')?.count).toBe(4);
  });

  it('ends on Saturday of the current week and marks later days future', () => {
    const now = new Date(2026, 9, 29, 12);
    const heatmap = buildLoginHeatmap([], now, 'en-US');
    const days = heatmap.weeks.flatMap((week) => week.days);

    expect(days[days.length - 1]?.key).toBe('2026-10-31');
    expect(findDay(heatmap, '2026-10-30')?.future).toBe(true);
    expect(findDay(heatmap, '2026-10-31')?.future).toBe(true);
    expect(findDay(heatmap, '2026-10-29')?.future).toBe(false);
  });

  it('uses GitHub-like intensity buckets', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 20].map(heatmapLevel)).toEqual([
      0, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('adds month labels without duplicating them across weeks', () => {
    const heatmap = buildLoginHeatmap(
      [],
      new Date(2026, 9, 29, 12),
      'en-US',
    );
    const labels = heatmap.weeks
      .map((week) => week.monthLabel)
      .filter((label): label is string => label !== undefined);

    expect(labels.length).toBeGreaterThan(10);
    expect(labels).toContain('Oct');
    expect(labels).toContain('Jan');
  });
});
