import { isValidTimeZone } from '../catalog/validation.ts';
import { ScheduleError } from './errors.ts';
import type { IsoWeekday, ScheduleTimeZone } from './types.ts';

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;

  if (!isValidTimeZone(timeZone)) {
    throw new ScheduleError(
      'invalid-time-zone',
      'timeZone',
      `is not a valid IANA time zone: \`${timeZone}\``,
    );
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function getWallClock(timestamp: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(timestamp));
  const values = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== 'literal') values.set(part.type, part.value);
  }

  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  };
}

/** Wall-clock components observed at an instant in the schedule's zone. */
export function getWallClockForZone(
  timestamp: number,
  zone: ScheduleTimeZone,
): WallClock {
  switch (zone.kind) {
    case 'iana':
      return getWallClock(timestamp, zone.timeZone);
    case 'utc':
      return getWallClock(timestamp, 'UTC');
    case 'fixed-offset':
      return getWallClock(timestamp + zone.offsetMinutes * 60_000, 'UTC');
  }
}

function zoneOffsetMs(timestamp: number, timeZone: string): number {
  const wholeSecond = Math.floor(timestamp / 1000) * 1000;
  const wall = getWallClock(wholeSecond, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - wholeSecond;
}

function sameWallClock(left: WallClock, right: WallClock): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

/**
 * Converts wall-clock components in a zone to an absolute instant.
 *
 * IANA zones can skip or repeat a wall-clock time at daylight-saving
 * transitions. A skipped time resolves forward to the first instant after the
 * gap, and an ambiguous time resolves to the earlier occurrence. This keeps
 * calculations deterministic without maintaining daylight-saving rules.
 */
export function wallTimeToTimestamp(
  wall: WallClock,
  zone: ScheduleTimeZone,
): number {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  if (zone.kind === 'utc') return naive;
  if (zone.kind === 'fixed-offset') {
    return naive - zone.offsetMinutes * 60_000;
  }

  const offsets = new Set<number>();
  for (const delta of [-2 * DAY_MS, -DAY_MS, 0, DAY_MS, 2 * DAY_MS]) {
    offsets.add(zoneOffsetMs(naive + delta, zone.timeZone));
  }

  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (sameWallClock(getWallClock(candidate, zone.timeZone), wall)) {
      candidates.push(candidate);
    }
  }

  if (candidates.length > 0) return Math.min(...candidates);

  // No candidate exists (a spring-forward gap). The smallest offset produces
  // the latest instant, which is the first valid time after the gap.
  return naive - Math.min(...offsets);
}

export function addWallDays(wall: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    ...wall,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function isoWeekday(wall: WallClock): IsoWeekday {
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}
