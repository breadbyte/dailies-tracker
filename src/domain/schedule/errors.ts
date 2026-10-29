export type ScheduleErrorCode =
  | 'invalid-schedule'
  | 'invalid-time-zone'
  | 'invalid-time'
  | 'invalid-weekday'
  | 'invalid-weekdays'
  | 'invalid-interval'
  | 'invalid-timestamp'
  | 'invalid-reference';

/** A deterministic schedule validation or calculation failure. */
export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode;
  readonly path: string;

  constructor(code: ScheduleErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ScheduleError';
    this.code = code;
    this.path = path;
  }
}
