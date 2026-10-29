import { describe, expect, it } from 'vitest';
import { formatRemaining } from '../../../src/domain/schedule/format.ts';

describe('formatRemaining', () => {
  it('formats hours, minutes, and seconds', () => {
    expect(formatRemaining(12 * 3_600_000)).toBe('12:00:00');
    expect(formatRemaining(3_661_000)).toBe('01:01:01');
  });

  it('formats multi-day durations with a day prefix', () => {
    expect(formatRemaining(90_061_000)).toBe('1d 01:01:01');
  });

  it('rounds partial seconds up and clamps past values', () => {
    expect(formatRemaining(1)).toBe('00:00:01');
    expect(formatRemaining(0)).toBe('00:00:00');
    expect(formatRemaining(-5_000)).toBe('00:00:00');
  });
});
