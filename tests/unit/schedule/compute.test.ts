import { describe, expect, it } from 'vitest';
import { getScheduleOccurrence } from '../../../src/domain/schedule/compute.ts';
import type { Schedule } from '../../../src/domain/schedule/types.ts';

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function at(schedule: Schedule, reference: string) {
  return getScheduleOccurrence(schedule, Date.parse(reference));
}

const berlinDailyFour: Schedule = {
  kind: 'daily',
  timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
  time: '04:00',
};

describe('daily schedules', () => {
  it('calculates a local wall-clock reset before and after the boundary', () => {
    const before = at(berlinDailyFour, '2026-01-15T02:00:00.000Z');
    expect(iso(before.nextAt)).toBe('2026-01-15T03:00:00.000Z');
    expect(iso(before.previousAt)).toBe('2026-01-14T03:00:00.000Z');
    expect(before.remainingMs).toBe(3_600_000);

    const after = at(berlinDailyFour, '2026-01-15T10:00:00.000Z');
    expect(iso(after.nextAt)).toBe('2026-01-16T03:00:00.000Z');
    expect(iso(after.previousAt)).toBe('2026-01-15T03:00:00.000Z');
  });

  it('treats an exact reset instant as the previous occurrence', () => {
    const result = at(berlinDailyFour, '2026-01-15T03:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-01-16T03:00:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-01-15T03:00:00.000Z');
  });

  it('keeps UTC resets absolute across daylight-saving changes', () => {
    const utcDaily: Schedule = {
      kind: 'daily',
      timeZone: { kind: 'utc' },
      time: '04:00',
    };
    const result = at(utcDaily, '2026-03-29T03:30:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-03-29T04:00:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-03-28T04:00:00.000Z');
  });

  it('uses the IANA zone for local resets but not for fixed UTC resets', () => {
    const newYorkDaily: Schedule = {
      kind: 'daily',
      timeZone: { kind: 'iana', timeZone: 'America/New_York' },
      time: '04:00',
    };
    const local = at(newYorkDaily, '2026-03-08T06:00:00.000Z');
    expect(iso(local.nextAt)).toBe('2026-03-08T08:00:00.000Z');

    const fixed = at(
      {
        kind: 'daily',
        timeZone: { kind: 'fixed-offset', offsetMinutes: -300 },
        time: '04:00',
      },
      '2026-03-08T06:00:00.000Z',
    );
    expect(iso(fixed.nextAt)).toBe('2026-03-08T09:00:00.000Z');
  });

  it('resolves a spring-forward gap forward to the first valid instant', () => {
    const gapDaily: Schedule = {
      kind: 'daily',
      timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
      time: '02:30',
    };
    const result = at(gapDaily, '2026-03-29T00:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-03-28T01:30:00.000Z');
  });

  it('counts an ambiguous fall-back time once, at the earlier occurrence', () => {
    const overlapDaily: Schedule = {
      kind: 'daily',
      timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
      time: '02:30',
    };

    const beforeFirst = at(overlapDaily, '2026-10-25T00:15:00.000Z');
    expect(iso(beforeFirst.nextAt)).toBe('2026-10-25T00:30:00.000Z');

    const between = at(overlapDaily, '2026-10-25T00:45:00.000Z');
    expect(iso(between.previousAt)).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(between.nextAt)).toBe('2026-10-26T01:30:00.000Z');
  });

  it('handles leap days and midnight boundaries', () => {
    const leap = at(
      {
        kind: 'daily',
        timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
        time: '00:00',
      },
      '2028-02-28T12:00:00.000Z',
    );
    expect(iso(leap.nextAt)).toBe('2028-02-28T23:00:00.000Z');

    const tokyoMidnight: Schedule = {
      kind: 'daily',
      timeZone: { kind: 'iana', timeZone: 'Asia/Tokyo' },
      time: '00:00',
    };
    const justBefore = at(tokyoMidnight, '2026-01-15T14:59:59.000Z');
    expect(iso(justBefore.nextAt)).toBe('2026-01-15T15:00:00.000Z');
    const exactly = at(tokyoMidnight, '2026-01-15T15:00:00.000Z');
    expect(iso(exactly.nextAt)).toBe('2026-01-16T15:00:00.000Z');
    expect(iso(exactly.previousAt)).toBe('2026-01-15T15:00:00.000Z');
  });

  it('recalculates after a large clock jump without drift', () => {
    const result = at(berlinDailyFour, '2026-02-15T10:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-02-16T03:00:00.000Z');
    expect(result.remainingMs).toBe(17 * 3_600_000);
  });
});

describe('weekly schedules', () => {
  const mondayFour: Schedule = {
    kind: 'weekly',
    timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
    time: '04:00',
    weekday: 1,
  };

  it('calculates the next and previous week boundary', () => {
    const result = at(mondayFour, '2026-01-15T10:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-01-19T03:00:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-01-12T03:00:00.000Z');

    const sundayNight = at(mondayFour, '2026-01-18T23:30:00.000Z');
    expect(iso(sundayNight.nextAt)).toBe('2026-01-19T03:00:00.000Z');
  });

  it('follows daylight-saving transitions', () => {
    const result = at(mondayFour, '2026-03-23T12:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-03-30T02:00:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-03-23T03:00:00.000Z');
  });
});

describe('custom recurring schedules', () => {
  const mondayWednesdayFriday: Schedule = {
    kind: 'custom',
    timeZone: { kind: 'iana', timeZone: 'America/New_York' },
    time: '09:00',
    weekdays: [1, 3, 5],
  };

  it('finds the next selected weekday and skips unselected days', () => {
    const result = at(mondayWednesdayFriday, '2026-01-14T15:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-01-16T14:00:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-01-14T14:00:00.000Z');

    const fridayAfterTime = at(
      mondayWednesdayFriday,
      '2026-01-16T14:30:00.000Z',
    );
    expect(iso(fridayAfterTime.nextAt)).toBe('2026-01-19T14:00:00.000Z');
    expect(iso(fridayAfterTime.previousAt)).toBe('2026-01-16T14:00:00.000Z');
  });
});

describe('interval schedules', () => {
  const everyNinetyMinutes: Schedule = {
    kind: 'interval',
    anchor: '2026-01-01T00:00:00.000Z',
    intervalMinutes: 90,
  };

  it('calculates the next and previous refreshes', () => {
    const result = at(everyNinetyMinutes, '2026-01-01T01:00:00.000Z');
    expect(iso(result.nextAt)).toBe('2026-01-01T01:30:00.000Z');
    expect(iso(result.previousAt)).toBe('2026-01-01T00:00:00.000Z');
    expect(result.remainingMs).toBe(1_800_000);
  });

  it('handles references before the anchor and exact boundaries', () => {
    const beforeAnchor = at(everyNinetyMinutes, '2025-12-31T23:00:00.000Z');
    expect(iso(beforeAnchor.nextAt)).toBe('2026-01-01T00:00:00.000Z');
    expect(beforeAnchor.previousAt).toBeNull();
    expect(beforeAnchor.remainingMs).toBe(3_600_000);

    const exact = at(everyNinetyMinutes, '2026-01-01T01:30:00.000Z');
    expect(iso(exact.nextAt)).toBe('2026-01-01T03:00:00.000Z');
    expect(iso(exact.previousAt)).toBe('2026-01-01T01:30:00.000Z');
  });
});

describe('one-off schedules', () => {
  const event: Schedule = {
    kind: 'one-off',
    at: '2026-02-01T12:00:00.000Z',
  };

  it('reports the upcoming event, then moves it to the past', () => {
    const before = at(event, '2026-02-01T11:00:00.000Z');
    expect(iso(before.nextAt)).toBe('2026-02-01T12:00:00.000Z');
    expect(before.previousAt).toBeNull();
    expect(before.remainingMs).toBe(3_600_000);

    const after = at(event, '2026-02-01T13:00:00.000Z');
    expect(after.nextAt).toBeNull();
    expect(iso(after.previousAt)).toBe('2026-02-01T12:00:00.000Z');
    expect(after.remainingMs).toBeNull();
  });
});

describe('invalid inputs', () => {
  it('rejects an invalid reference timestamp', () => {
    expect(() =>
      getScheduleOccurrence(berlinDailyFour, new Date('not-a-date')),
    ).toThrow(/finite timestamp/);
  });
});
