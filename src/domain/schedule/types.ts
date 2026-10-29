/**
 * Pure schedule model.
 *
 * Schedules are definitions, never ticking counters. Occurrences are derived
 * from a reference timestamp, so the same definitions always produce the same
 * results.
 */

/** ISO weekday: Monday is 1 and Sunday is 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * How a schedule anchors its wall-clock time.
 *
 * - `iana`: wall-clock time in an IANA time zone. It follows daylight-saving
 *   transitions.
 * - `utc`: fixed UTC time. It never shifts with a local wall clock.
 * - `fixed-offset`: wall-clock time at a constant UTC offset, without
 *   daylight-saving rules.
 */
export type ScheduleTimeZone =
  | { kind: 'iana'; timeZone: string }
  | { kind: 'utc' }
  | { kind: 'fixed-offset'; offsetMinutes: number };

/** A reset or event that happens once per day at a wall-clock time. */
export interface DailySchedule {
  kind: 'daily';
  timeZone: ScheduleTimeZone;
  /** `HH:mm` in 24-hour time. */
  time: string;
}

/** A reset that happens once per week on an ISO weekday. */
export interface WeeklySchedule {
  kind: 'weekly';
  timeZone: ScheduleTimeZone;
  /** `HH:mm` in 24-hour time. */
  time: string;
  weekday: IsoWeekday;
}

/** A user-defined recurring event on selected ISO weekdays. */
export interface CustomSchedule {
  kind: 'custom';
  timeZone: ScheduleTimeZone;
  /** `HH:mm` in 24-hour time. */
  time: string;
  weekdays: IsoWeekday[];
}

/** A refresh that repeats at a fixed absolute interval. */
export interface IntervalSchedule {
  kind: 'interval';
  /** Canonical UTC ISO 8601 anchor timestamp. */
  anchor: string;
  intervalMinutes: number;
}

/** A single absolute event. */
export interface OneOffSchedule {
  kind: 'one-off';
  /** Canonical UTC ISO 8601 timestamp. */
  at: string;
}

export type Schedule =
  | DailySchedule
  | WeeklySchedule
  | CustomSchedule
  | IntervalSchedule
  | OneOffSchedule;

export type ScheduleKind = Schedule['kind'];

/** Result of resolving a catalog server together with an optional override. */
export interface ResolvedServerSchedule {
  serverId: string;
  source: 'catalog' | 'override';
  schedule: Schedule;
}

/** Occurrences are absolute epoch milliseconds. */
export interface ScheduleOccurrence {
  nextAt: number | null;
  previousAt: number | null;
  remainingMs: number | null;
}
