const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const INPUT_TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const timeZoneCache = new Map<string, boolean>();

/** True only for the canonical zero-padded `HH:mm` form. */
export function isValidDailyResetTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * Accepts the upstream's occasionally unpadded `H:mm` form and returns the
 * canonical `HH:mm` form. Returns undefined for anything else.
 */
export function normalizeDailyResetTime(value: string): string | undefined {
  const match = INPUT_TIME_PATTERN.exec(value);
  if (!match) return undefined;
  return `${match[1]?.padStart(2, '0')}:${match[2]}`;
}

export function isValidTimeZone(value: string): boolean {
  const cached = timeZoneCache.get(value);
  if (cached !== undefined) return cached;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    valid = value.trim() !== '';
  } catch {
    valid = false;
  }
  timeZoneCache.set(value, valid);
  return valid;
}

/**
 * Produces a stable, URL-safe ID fragment. The result is derived from the
 * upstream display name, so renaming a game or server changes its ID.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
