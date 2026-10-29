import { describe, expect, it } from 'vitest';
import { isCompletionInCurrentCycle } from '../../../src/domain/tracking/login.ts';

const occurrence = {
  nextAt: Date.parse('2026-11-02T00:00:00.000Z'),
  previousAt: Date.parse('2026-11-01T00:00:00.000Z'),
  remainingMs: 1,
};

describe('login cycle completion', () => {
  it('counts a completion at or after the previous reset', () => {
    expect(
      isCompletionInCurrentCycle('2026-11-01T00:00:00.000Z', occurrence),
    ).toBe(true);
    expect(
      isCompletionInCurrentCycle('2026-11-01T09:30:00.000Z', occurrence),
    ).toBe(true);
  });

  it('ignores older completions and missing history', () => {
    expect(
      isCompletionInCurrentCycle('2026-10-31T23:59:59.999Z', occurrence),
    ).toBe(false);
    expect(isCompletionInCurrentCycle(undefined, occurrence)).toBe(false);
    expect(isCompletionInCurrentCycle('not-a-date', occurrence)).toBe(false);
  });

  it('treats a schedule without a previous occurrence as incomplete', () => {
    expect(
      isCompletionInCurrentCycle('2026-11-01T09:30:00.000Z', {
        ...occurrence,
        previousAt: null,
      }),
    ).toBe(false);
  });
});
