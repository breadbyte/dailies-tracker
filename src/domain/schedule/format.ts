function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formats a remaining duration as `HH:MM:SS`, or `Nd HH:MM:SS` for durations
 * of a day or more. Partial seconds round up so a countdown reaches zero only
 * when the occurrence is due.
 */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return '00:00:00';

  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return days > 0 ? `${days}d ${clock}` : clock;
}
