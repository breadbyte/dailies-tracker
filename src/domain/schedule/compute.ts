import { ScheduleError } from './errors.ts';
import {
  addWallDays,
  getWallClockForZone,
  isoWeekday,
  wallTimeToTimestamp,
  type WallClock,
} from './timeZone.ts';
import type {
  CustomSchedule,
  DailySchedule,
  IntervalSchedule,
  OneOffSchedule,
  Schedule,
  ScheduleOccurrence,
  ScheduleTimeZone,
  WeeklySchedule,
} from './types.ts';
import { parseSchedule } from './validation.ts';

function timeParts(time: string): { hour: number; minute: number } {
  return {
    hour: Number(time.slice(0, 2)),
    minute: Number(time.slice(3, 5)),
  };
}

function atWallTime(
  wall: WallClock,
  time: string,
  zone: ScheduleTimeZone,
): number {
  const { hour, minute } = timeParts(time);
  return wallTimeToTimestamp({ ...wall, hour, minute, second: 0 }, zone);
}

function dailyOccurrence(
  schedule: DailySchedule,
  now: number,
): { next: number; previous: number } {
  const nowWall = getWallClockForZone(now, schedule.timeZone);
  let next = atWallTime(nowWall, schedule.time, schedule.timeZone);
  let previous = atWallTime(
    addWallDays(nowWall, -1),
    schedule.time,
    schedule.timeZone,
  );

  if (next <= now) {
    previous = next;
    next = atWallTime(
      addWallDays(nowWall, 1),
      schedule.time,
      schedule.timeZone,
    );
  }

  return { next, previous };
}

function weeklyOccurrence(
  schedule: WeeklySchedule,
  now: number,
): { next: number; previous: number } {
  const nowWall = getWallClockForZone(now, schedule.timeZone);
  let delta = (schedule.weekday - isoWeekday(nowWall) + 7) % 7;
  let next = atWallTime(
    addWallDays(nowWall, delta),
    schedule.time,
    schedule.timeZone,
  );

  if (next <= now) {
    delta += 7;
    next = atWallTime(
      addWallDays(nowWall, delta),
      schedule.time,
      schedule.timeZone,
    );
  }

  const previous = atWallTime(
    addWallDays(nowWall, delta - 7),
    schedule.time,
    schedule.timeZone,
  );

  return { next, previous };
}

function customOccurrence(
  schedule: CustomSchedule,
  now: number,
): { next: number | null; previous: number | null } {
  const nowWall = getWallClockForZone(now, schedule.timeZone);
  const weekdays = new Set<number>(schedule.weekdays);

  let next: number | null = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const date = addWallDays(nowWall, dayOffset);
    if (!weekdays.has(isoWeekday(date))) continue;
    const candidate = atWallTime(date, schedule.time, schedule.timeZone);
    if (candidate > now) {
      next = candidate;
      break;
    }
  }

  let previous: number | null = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const date = addWallDays(nowWall, -dayOffset);
    if (!weekdays.has(isoWeekday(date))) continue;
    const candidate = atWallTime(date, schedule.time, schedule.timeZone);
    if (candidate <= now) {
      previous = candidate;
      break;
    }
  }

  return { next, previous };
}

function intervalOccurrence(
  schedule: IntervalSchedule,
  now: number,
): { next: number; previous: number | null } {
  const anchor = Date.parse(schedule.anchor);
  const intervalMs = schedule.intervalMinutes * 60_000;

  if (now < anchor) return { next: anchor, previous: null };

  const index = Math.floor((now - anchor) / intervalMs);
  return {
    next: anchor + (index + 1) * intervalMs,
    previous: anchor + index * intervalMs,
  };
}

function oneOffOccurrence(
  schedule: OneOffSchedule,
  now: number,
): { next: number | null; previous: number | null } {
  const at = Date.parse(schedule.at);
  return {
    next: at > now ? at : null,
    previous: at <= now ? at : null,
  };
}

/**
 * Calculates the next and previous occurrences of a schedule at a reference
 * instant. The result depends only on the schedule and the reference, so it is
 * safe to recompute after sleep, tab suspension, or large clock jumps.
 */
export function getScheduleOccurrence(
  schedule: Schedule,
  reference: Date | number,
): ScheduleOccurrence {
  const validated = parseSchedule(schedule);
  const now =
    typeof reference === 'number' ? reference : reference.getTime();

  if (!Number.isFinite(now)) {
    throw new ScheduleError(
      'invalid-reference',
      'reference',
      'must be a finite timestamp',
    );
  }

  let next: number | null;
  let previous: number | null;

  switch (validated.kind) {
    case 'daily':
      ({ next, previous } = dailyOccurrence(validated, now));
      break;
    case 'weekly':
      ({ next, previous } = weeklyOccurrence(validated, now));
      break;
    case 'custom':
      ({ next, previous } = customOccurrence(validated, now));
      break;
    case 'interval':
      ({ next, previous } = intervalOccurrence(validated, now));
      break;
    case 'one-off':
      ({ next, previous } = oneOffOccurrence(validated, now));
      break;
  }

  return {
    nextAt: next,
    previousAt: previous,
    remainingMs: next === null ? null : Math.max(0, next - now),
  };
}
