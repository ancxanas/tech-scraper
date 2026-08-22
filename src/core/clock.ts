/**
 * Process-wide clock, shiftable in tests.
 *
 * Production code reads `now()` / `isoNow()` instead of touching `Date`
 * directly, so a test can move the whole pipeline days forward and watch
 * cache TTLs expire without sleeping or faking modules.
 */
let offsetMs = 0;

/** Shift every subsequent read by `ms` (negative shifts back). */
export function shiftClock(ms: number): void {
  offsetMs = ms;
}

export function now(): number {
  return Date.now() + offsetMs;
}

export function isoNow(): string {
  return new Date(now()).toISOString();
}
