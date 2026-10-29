import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNow } from '../../../src/features/dashboard/useNow.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('re-reads the clock when a suspended tab becomes visible again', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

    const clock = { now: () => new Date() };
    const { result } = renderHook(() => useNow({ clock }));

    expect(result.current.toISOString()).toBe('2026-01-15T12:00:00.000Z');

    vi.setSystemTime(new Date('2026-01-15T18:30:00.000Z'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.toISOString()).toBe('2026-01-15T18:30:00.000Z');

    vi.setSystemTime(new Date('2026-01-16T01:15:00.000Z'));
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(result.current.toISOString()).toBe('2026-01-16T01:15:00.000Z');
  });
});
