const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** `now`, `12m`, `3h`, `5d`, then the date: how long before `now` (ms) `iso` was, as short as a readout can hold. */
export function formatStudioAgo(iso: string, now: number): string {
  const ago = now - Date.parse(iso);
  if (ago < MINUTE) return 'now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h`;
  if (ago < 14 * DAY) return `${Math.floor(ago / DAY)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
