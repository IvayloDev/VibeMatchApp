import { msUntilQuotaReset, formatQuotaReset, matchDayKey, nextResetAt } from './proQuota';

/**
 * One free match a day.
 *
 * Guests burn their 3 starter credits in minutes and then hit a wall with
 * nothing to come back for. This hands out exactly one credit per local
 * calendar day and never more: the day is marked as spoken for whether or not
 * anything was granted, so a balance that already covers today does not earn
 * a second free match later the same day. Nothing ever stacks, and Pro is
 * untouched (it has its own daily quota).
 *
 * The "last granted on" date is keyed by the device id from freeCredits.ts,
 * which lives in the Keychain and survives a reinstall on iOS - the same
 * anti-farming approach as the one-time starter credits.
 */

/** When the next free match becomes claimable: the next 09:00 local. */
export function nextLocalMidnight(): Date {
  return nextResetAt();
}

/** "14h" / "3h 20m" / "under a minute" until `date`. */
export function formatUntil(date: Date): string {
  return formatQuotaReset(Math.max(0, date.getTime() - Date.now()));
}

/**
 * The granting half of this module is gone.
 *
 * claimDailyCreditIfDue read a balance, added one, and wrote the result. It
 * ran on every Dashboard mount and every foreground, so a failed read
 * returning 0 became an absolute write of 1 over whatever the user actually
 * had. The rule it implemented - one match a day, at 09:00 local, only when
 * the balance is zero, never stacking - now lives in claim_free_match_for on
 * the server, where the balance cannot be misread from the client.
 *
 * What remains here is the clock: when the next free match lands, and how to
 * say that in words. The server returns next_free_at computed in the user's
 * own timezone, and these format it.
 */
