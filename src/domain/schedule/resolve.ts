import type { GameServerDefinition } from '../catalog/types.ts';
import type {
  DailySchedule,
  ResolvedServerSchedule,
  Schedule,
} from './types.ts';
import { parseSchedule } from './validation.ts';

/**
 * Derives a schedule from a catalog server definition.
 *
 * A `utc` daily reset stays absolute: the server's IANA zone is metadata only
 * and is not reused as a wall-clock zone.
 */
export function catalogSchedule(
  server: GameServerDefinition,
): DailySchedule {
  const schedule: DailySchedule = {
    kind: 'daily',
    timeZone:
      server.dailyReset.basis === 'utc'
        ? { kind: 'utc' }
        : { kind: 'iana', timeZone: server.timeZone },
    time: server.dailyReset.time,
  };
  return parseSchedule(schedule) as DailySchedule;
}

/**
 * Resolves a server's effective schedule. A user override wins without
 * mutating the catalog definition, so catalog refreshes cannot destroy custom
 * schedules and user schedules cannot rewrite bundled data.
 */
export function resolveServerSchedule(
  server: GameServerDefinition,
  override?: Schedule | null,
): ResolvedServerSchedule {
  if (override === undefined || override === null) {
    return {
      serverId: server.id,
      source: 'catalog',
      schedule: catalogSchedule(server),
    };
  }

  return {
    serverId: server.id,
    source: 'override',
    schedule: parseSchedule(override),
  };
}
