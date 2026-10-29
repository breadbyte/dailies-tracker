/**
 * Shared clock boundary.
 *
 * Domain calculations receive explicit timestamps; UI code reads the current
 * time through this interface so countdown behavior can be tested with a
 * controlled clock.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
