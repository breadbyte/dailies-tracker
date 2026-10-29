import type {
  IsoWeekday,
  Schedule,
  ScheduleTimeZone,
} from '../../domain/schedule/types.ts';

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function weekdayName(weekday: IsoWeekday): string {
  return WEEKDAY_NAMES[weekday - 1] ?? '';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function zoneLabel(zone: ScheduleTimeZone): string {
  switch (zone.kind) {
    case 'iana':
      return zone.timeZone;
    case 'utc':
      return 'UTC';
    case 'fixed-offset': {
      const sign = zone.offsetMinutes >= 0 ? '+' : '-';
      const absolute = Math.abs(zone.offsetMinutes);
      return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
    }
  }
}

export function scheduleSummary(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'daily':
      return `daily at ${schedule.time} ${zoneLabel(schedule.timeZone)}`;
    case 'weekly':
      return `weekly on ${weekdayName(schedule.weekday)} at ${schedule.time} ${zoneLabel(schedule.timeZone)}`;
    case 'custom':
      return `on ${schedule.weekdays.map(weekdayName).join(', ')} at ${schedule.time} ${zoneLabel(schedule.timeZone)}`;
    case 'interval':
      return `every ${schedule.intervalMinutes} minutes`;
    case 'one-off':
      return 'one-off event';
  }
}

export function formatOccurrence(nextAt: number, schedule: Schedule): string {
  switch (schedule.kind) {
    case 'daily':
    case 'weekly':
    case 'custom': {
      const zone = schedule.timeZone;
      if (zone.kind === 'fixed-offset') {
        const shifted = new Date(nextAt + zone.offsetMinutes * 60_000);
        const formatted = new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(shifted);
        return `${formatted} (${zoneLabel(zone)})`;
      }
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: zone.kind === 'iana' ? zone.timeZone : 'UTC',
      }).format(new Date(nextAt));
    }
    case 'interval':
    case 'one-off':
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(nextAt));
  }
}
