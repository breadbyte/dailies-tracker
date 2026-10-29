import { describe, expect, it } from 'vitest';
import { ScheduleError } from '../../../src/domain/schedule/errors.ts';
import { parseSchedule } from '../../../src/domain/schedule/validation.ts';

const daily = {
  kind: 'daily',
  timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
  time: '04:00',
};

function expectCode(value: unknown, code: string): void {
  try {
    parseSchedule(value);
    throw new Error('expected schedule validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduleError);
    expect((error as ScheduleError).code).toBe(code);
  }
}

describe('schedule validation', () => {
  it('round-trips a valid schedule', () => {
    expect(parseSchedule(daily)).toEqual(daily);
  });

  it('normalizes custom weekdays by sorting them', () => {
    expect(
      parseSchedule({
        kind: 'custom',
        timeZone: { kind: 'utc' },
        time: '09:30',
        weekdays: [5, 1, 3],
      }),
    ).toMatchObject({ weekdays: [1, 3, 5] });
  });

  it('rejects invalid time zones and times', () => {
    expectCode(
      {
        ...daily,
        timeZone: { kind: 'iana', timeZone: 'Mars/Olympus' },
      },
      'invalid-time-zone',
    );
    expectCode(
      { ...daily, timeZone: { kind: 'fixed-offset', offsetMinutes: 900 } },
      'invalid-time-zone',
    );
    expectCode(
      { ...daily, timeZone: { kind: 'fixed-offset', offsetMinutes: 30.5 } },
      'invalid-time-zone',
    );
    expectCode(
      { ...daily, timeZone: { kind: 'offset', offsetMinutes: 60 } },
      'invalid-time-zone',
    );
    expectCode({ ...daily, time: '24:00' }, 'invalid-time');
    expectCode({ ...daily, time: '4:00' }, 'invalid-time');
  });

  it('rejects invalid weekly and custom recurrence definitions', () => {
    expectCode(
      {
        kind: 'weekly',
        timeZone: { kind: 'utc' },
        time: '04:00',
        weekday: 0,
      },
      'invalid-weekday',
    );
    expectCode(
      {
        kind: 'weekly',
        timeZone: { kind: 'utc' },
        time: '04:00',
        weekday: 8,
      },
      'invalid-weekday',
    );
    expectCode(
      {
        kind: 'custom',
        timeZone: { kind: 'utc' },
        time: '04:00',
        weekdays: [],
      },
      'invalid-weekdays',
    );
    expectCode(
      {
        kind: 'custom',
        timeZone: { kind: 'utc' },
        time: '04:00',
        weekdays: [1, 1],
      },
      'invalid-weekdays',
    );
  });

  it('requires canonical timestamps and positive intervals', () => {
    expectCode(
      {
        kind: 'interval',
        anchor: '2026-01-01T00:00:00Z',
        intervalMinutes: 30,
      },
      'invalid-timestamp',
    );
    expectCode(
      {
        kind: 'interval',
        anchor: '2026-01-01T00:00:00.000Z',
        intervalMinutes: 0,
      },
      'invalid-interval',
    );
    expectCode(
      {
        kind: 'interval',
        anchor: '2026-01-01T00:00:00.000Z',
        intervalMinutes: 1.5,
      },
      'invalid-interval',
    );
    expectCode(
      { kind: 'one-off', at: 'not-a-date' },
      'invalid-timestamp',
    );
  });

  it('rejects unknown schedule kinds and fields', () => {
    expectCode({ kind: 'monthly', day: 1 }, 'invalid-schedule');
    expectCode({ ...daily, extra: true }, 'invalid-schedule');
  });
});
