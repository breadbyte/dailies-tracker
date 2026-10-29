import { useEffect, useState } from 'react';
import { systemClock, type Clock } from '../../services/clock/clock.ts';

export interface UseNowOptions {
  clock?: Clock;
  intervalMs?: number;
}

/**
 * Returns the current time, refreshing on aligned intervals and immediately
 * when the tab becomes visible or the page is restored.
 *
 * Displayed values are always derived from the clock rather than incremented,
 * so throttled timers, sleep, and large clock jumps cannot accumulate drift.
 */
export function useNow(options: UseNowOptions = {}): Date {
  const clock = options.clock ?? systemClock;
  const intervalMs = options.intervalMs ?? 1000;
  const [now, setNow] = useState(() => clock.now());

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const update = () => {
      if (!cancelled) setNow(clock.now());
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const current = clock.now().getTime();
      const remainder = ((current % intervalMs) + intervalMs) % intervalMs;
      const delay = remainder === 0 ? intervalMs : intervalMs - remainder;
      timer = window.setTimeout(() => {
        update();
        scheduleNext();
      }, delay);
    };

    update();
    scheduleNext();

    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
    };
  }, [clock, intervalMs]);

  return now;
}
