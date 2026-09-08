/**
 * Daily match quota for TuneMatch Pro subscribers.
 *
 * The subscription is sold as "10 song matches every day" (deliberately NOT
 * "unlimited" - a capped plan must not claim unlimited). The cap itself is
 * enforced on the server: charge_scan counts a Pro user's settled scans since
 * the last 09:00 local and falls through to credits once PRO_DAILY_LIMIT is
 * reached, and get_credit_state reports pro_used_today for the UI. Nothing on
 * the client counts scans any more - the old AsyncStorage counter was deleted
 * once the server number existed, because a client counter that nothing
 * writes is a number the UI will happily display while it drifts.
 *
 * What stays here is the limit and the reset clock: the match day starts at
 * 09:00 local rather than midnight, so the reset lands when someone is awake
 * to use it. These helpers say when that is so the UI can count down to it.
 */
export const PRO_DAILY_LIMIT = 10;

/** The hour the match day rolls over, local time. */
export const RESET_HOUR = 9;

/**
 * The current match day as YYYY-MM-DD, local time, rolling over at
 * RESET_HOUR. Between midnight and 08:59 this still names yesterday, which is
 * what keeps a match used at 01:00 on the same day's allowance.
 */
export function matchDayKey(at: Date = new Date()): string {
  const d = new Date(at.getTime() - RESET_HOUR * 60 * 60 * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The next 09:00 local: when the allowance refreshes. */
export function nextResetAt(from: Date = new Date()): Date {
  const at = new Date(from);
  at.setHours(RESET_HOUR, 0, 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * Milliseconds until the allowance resets.
 *
 * There is no timer anywhere - the reset is implicit on the server, which
 * simply counts scans since the most recent 09:00. This measures the distance
 * to the next one so the UI can say when.
 */
export function msUntilQuotaReset(): number {
  const now = new Date();
  return Math.max(0, nextResetAt(now).getTime() - now.getTime());
}

/** "14h 27m 12s" / "38m 04s" / "9s" - when the next batch lands, to the second. */
export function formatQuotaReset(ms: number = msUntilQuotaReset()): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${ss}s`;
  if (minutes > 0) return `${minutes}m ${ss}s`;
  return `${seconds}s`;
}
