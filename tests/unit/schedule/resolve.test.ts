import { describe, expect, it } from 'vitest';
import type { GameServerDefinition } from '../../../src/domain/catalog/types.ts';
import {
  catalogSchedule,
  resolveServerSchedule,
} from '../../../src/domain/schedule/resolve.ts';
import type { Schedule } from '../../../src/domain/schedule/types.ts';

const localServer: GameServerDefinition = {
  id: 'alpha-game:global',
  name: 'Global',
  timeZone: 'Europe/Berlin',
  dailyReset: { time: '04:00', basis: 'local' },
};

describe('server schedule resolution', () => {
  it('derives a local wall-clock schedule from a catalog server', () => {
    expect(catalogSchedule(localServer)).toEqual({
      kind: 'daily',
      timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
      time: '04:00',
    });
  });

  it('keeps a UTC reset absolute instead of reusing the server zone', () => {
    const utcServer: GameServerDefinition = {
      ...localServer,
      timeZone: 'America/New_York',
      dailyReset: { time: '10:00', basis: 'utc' },
    };
    expect(catalogSchedule(utcServer)).toEqual({
      kind: 'daily',
      timeZone: { kind: 'utc' },
      time: '10:00',
    });
  });

  it('lets an override win without mutating catalog data', () => {
    const before = JSON.parse(JSON.stringify(localServer)) as unknown;
    const override: Schedule = {
      kind: 'weekly',
      timeZone: { kind: 'iana', timeZone: 'Europe/Berlin' },
      time: '05:30',
      weekday: 3,
    };

    const resolved = resolveServerSchedule(localServer, override);
    expect(resolved).toEqual({
      serverId: 'alpha-game:global',
      source: 'override',
      schedule: override,
    });
    expect(catalogSchedule(localServer)).toMatchObject({
      kind: 'daily',
      time: '04:00',
    });
    expect(localServer).toEqual(before);
  });

  it('rejects an invalid override', () => {
    expect(() =>
      resolveServerSchedule(localServer, {
        kind: 'daily',
        timeZone: { kind: 'iana', timeZone: 'Mars/Olympus' },
        time: '04:00',
      }),
    ).toThrow(/valid IANA time zone/);
  });
});
