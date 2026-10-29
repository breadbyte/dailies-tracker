import {
  isValidDailyResetTime,
  isValidTimeZone,
} from '../catalog/validation.ts';
import { ScheduleError } from './errors.ts';
import type {
  IsoWeekday,
  Schedule,
  ScheduleTimeZone,
} from './types.ts';

const MAX_OFFSET_MINUTES = 14 * 60;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new ScheduleError('invalid-schedule', path, 'must be an object');
  }
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ScheduleError('invalid-schedule', path, 'must be an array');
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ScheduleError(
      'invalid-schedule',
      path,
      'must be a non-empty string',
    );
  }
  return value;
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new ScheduleError(
        'invalid-schedule',
        `${path}.${key}`,
        'is not a known field',
      );
    }
  }
}

function parseTime(value: unknown, path: string): string {
  const time = asString(value, path);
  if (!isValidDailyResetTime(time)) {
    throw new ScheduleError(
      'invalid-time',
      path,
      'must be a valid HH:mm time',
    );
  }
  return time;
}

function parseTimeZone(value: unknown, path: string): ScheduleTimeZone {
  const zone = asRecord(value, path);
  const kind = asString(zone.kind, `${path}.kind`);

  if (kind === 'iana') {
    rejectUnknownKeys(zone, ['kind', 'timeZone'], path);
    const timeZone = asString(zone.timeZone, `${path}.timeZone`);
    if (!isValidTimeZone(timeZone)) {
      throw new ScheduleError(
        'invalid-time-zone',
        `${path}.timeZone`,
        `is not a valid IANA time zone: \`${timeZone}\``,
      );
    }
    return { kind: 'iana', timeZone };
  }

  if (kind === 'utc') {
    rejectUnknownKeys(zone, ['kind'], path);
    return { kind: 'utc' };
  }

  if (kind === 'fixed-offset') {
    rejectUnknownKeys(zone, ['kind', 'offsetMinutes'], path);
    const offsetMinutes = zone.offsetMinutes;
    if (
      typeof offsetMinutes !== 'number' ||
      !Number.isInteger(offsetMinutes) ||
      offsetMinutes < -MAX_OFFSET_MINUTES ||
      offsetMinutes > MAX_OFFSET_MINUTES
    ) {
      throw new ScheduleError(
        'invalid-time-zone',
        `${path}.offsetMinutes`,
        `must be an integer between -${MAX_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES}`,
      );
    }
    return { kind: 'fixed-offset', offsetMinutes };
  }

  throw new ScheduleError(
    'invalid-time-zone',
    `${path}.kind`,
    'must be `iana`, `utc`, or `fixed-offset`',
  );
}

function parseWeekday(value: unknown, path: string): IsoWeekday {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 7
  ) {
    throw new ScheduleError(
      'invalid-weekday',
      path,
      'must be an ISO weekday from 1 (Monday) to 7 (Sunday)',
    );
  }
  return value as IsoWeekday;
}

function parseCanonicalTimestamp(value: unknown, path: string): string {
  const text = asString(value, path);
  const parsed = Date.parse(text);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== text
  ) {
    throw new ScheduleError(
      'invalid-timestamp',
      path,
      'must be a canonical UTC ISO 8601 timestamp',
    );
  }
  return text;
}

/**
 * Validates an untrusted schedule definition and returns a normalized copy.
 * Custom weekday lists are sorted and may not contain duplicates.
 */
export function parseSchedule(value: unknown): Schedule {
  const schedule = asRecord(value, 'schedule');
  const kind = asString(schedule.kind, 'schedule.kind');

  switch (kind) {
    case 'daily': {
      rejectUnknownKeys(schedule, ['kind', 'timeZone', 'time'], 'schedule');
      return {
        kind: 'daily',
        timeZone: parseTimeZone(schedule.timeZone, 'schedule.timeZone'),
        time: parseTime(schedule.time, 'schedule.time'),
      };
    }
    case 'weekly': {
      rejectUnknownKeys(
        schedule,
        ['kind', 'timeZone', 'time', 'weekday'],
        'schedule',
      );
      return {
        kind: 'weekly',
        timeZone: parseTimeZone(schedule.timeZone, 'schedule.timeZone'),
        time: parseTime(schedule.time, 'schedule.time'),
        weekday: parseWeekday(schedule.weekday, 'schedule.weekday'),
      };
    }
    case 'custom': {
      rejectUnknownKeys(
        schedule,
        ['kind', 'timeZone', 'time', 'weekdays'],
        'schedule',
      );
      const values = asArray(schedule.weekdays, 'schedule.weekdays');
      if (values.length === 0) {
        throw new ScheduleError(
          'invalid-weekdays',
          'schedule.weekdays',
          'must contain at least one weekday',
        );
      }
      const weekdays: IsoWeekday[] = [];
      const seen = new Set<number>();
      values.forEach((value, index) => {
        const weekday = parseWeekday(value, `schedule.weekdays[${index}]`);
        if (seen.has(weekday)) {
          throw new ScheduleError(
            'invalid-weekdays',
            `schedule.weekdays[${index}]`,
            'must not repeat a weekday',
          );
        }
        seen.add(weekday);
        weekdays.push(weekday);
      });
      weekdays.sort((a, b) => a - b);
      return {
        kind: 'custom',
        timeZone: parseTimeZone(schedule.timeZone, 'schedule.timeZone'),
        time: parseTime(schedule.time, 'schedule.time'),
        weekdays,
      };
    }
    case 'interval': {
      rejectUnknownKeys(
        schedule,
        ['kind', 'anchor', 'intervalMinutes'],
        'schedule',
      );
      const intervalMinutes = schedule.intervalMinutes;
      if (
        typeof intervalMinutes !== 'number' ||
        !Number.isSafeInteger(intervalMinutes) ||
        intervalMinutes <= 0
      ) {
        throw new ScheduleError(
          'invalid-interval',
          'schedule.intervalMinutes',
          'must be a positive integer',
        );
      }
      return {
        kind: 'interval',
        anchor: parseCanonicalTimestamp(schedule.anchor, 'schedule.anchor'),
        intervalMinutes,
      };
    }
    case 'one-off': {
      rejectUnknownKeys(schedule, ['kind', 'at'], 'schedule');
      return {
        kind: 'one-off',
        at: parseCanonicalTimestamp(schedule.at, 'schedule.at'),
      };
    }
    default:
      throw new ScheduleError(
        'invalid-schedule',
        'schedule.kind',
        'must be `daily`, `weekly`, `custom`, `interval`, or `one-off`',
      );
  }
}
