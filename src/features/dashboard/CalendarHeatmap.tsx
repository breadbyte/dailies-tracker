import { useMemo } from 'react';
import type { LoginCompletion } from '../../domain/storage/types.ts';
import {
  HEATMAP_LEVELS,
  buildLoginHeatmap,
  type HeatmapWeek,
} from '../../domain/tracking/heatmap.ts';

interface CalendarHeatmapProps {
  completions: readonly LoginCompletion[];
  now: Date;
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

function dayLabel(count: number, future: boolean, date: Date): string {
  const formatted = dayFormatter.format(date);
  if (future) return `Future date: ${formatted}`;
  if (count === 0) return `No games logged on ${formatted}`;
  return `${count} ${count === 1 ? 'game' : 'games'} logged on ${formatted}`;
}

function weekLabel(week: HeatmapWeek): string {
  return week.monthLabel ?? '';
}

export function CalendarHeatmap({ completions, now }: CalendarHeatmapProps) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const anchor = useMemo(() => new Date(year, month, day), [year, month, day]);
  const heatmap = useMemo(
    () => buildLoginHeatmap(completions, anchor),
    [completions, anchor],
  );
  const summary =
    heatmap.totalGames === 0
      ? 'No game logins recorded in the last year.'
      : `${heatmap.totalGames} game ${heatmap.totalGames === 1 ? 'login' : 'logins'} across ${heatmap.activeDays} ${heatmap.activeDays === 1 ? 'day' : 'days'} in the last year. Darker squares mean more games logged.`;

  return (
    <div className="heatmap">
      <p className="heatmap-summary">{summary}</p>

      <div className="heatmap-scroll">
        <div className="heatmap-body">
          <div className="heatmap-weekdays" aria-hidden="true">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>

          <div className="heatmap-cells">
            <div className="heatmap-months" aria-hidden="true">
              {heatmap.weeks.map((week) => (
                <span key={week.days[0]?.key}>{weekLabel(week)}</span>
              ))}
            </div>

            <div className="heatmap-grid" role="img" aria-label={summary}>
              {heatmap.weeks.flatMap((week) =>
                week.days.map((day) => (
                  <span
                    key={day.key}
                    className={`heatmap-day heatmap-level-${day.level}${day.future ? ' heatmap-future' : ''}`}
                    title={dayLabel(day.count, day.future, day.date)}
                    aria-hidden="true"
                  />
                )),
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        {Array.from({ length: HEATMAP_LEVELS + 1 }, (_, level) => (
          <span
            key={level}
            className={`heatmap-day heatmap-level-${level}`}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
