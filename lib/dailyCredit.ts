import * as SecureStore from 'expo-secure-store';
import { getLocalCredits, addLocalCredits, getUserCredits, updateUserCredits } from './credits';
import { getDeviceId } from './utils/freeCredits';
import { msUntilQuotaReset, formatQuotaReset } from './proQuota';
import { trackEvent } from './posthog';

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

const DAILY_CREDIT_LAST_KEY_PREFIX = 'tunematch_daily_credit_last_';

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
function sanitizeKey(str: string): string {
  return str.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Local calendar date as YYYY-MM-DD (local time, so the reset is local midnight). */
function localDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function storageKey(): Promise<string> {
  const deviceId = await getDeviceId();
  return `${DAILY_CREDIT_LAST_KEY_PREFIX}${sanitizeKey(deviceId)}`;
}

/** The next local midnight - when the next free match becomes claimable. */
export function nextLocalMidnight(): Date {
  return new Date(Date.now() + msUntilQuotaReset());
}

/** "14h" / "3h 20m" / "under a minute" until `date`. */
export function formatUntil(date: Date): string {
  return formatQuotaReset(Math.max(0, date.getTime() - Date.now()));
}

export type DailyCreditResult = { granted: boolean; nextAt: Date };

/**
 * Record that today's free credit is spoken for without granting anything.
 * Called when the starter credits are handed out, so a guest who burns all
 * three on day one sees "next free match in 14h" instead of a fourth match.
 */
export async function markDailyCreditGrantedToday(): Promise<void> {
  try {
    const key = await storageKey();
    await SecureStore.setItemAsync(key, localDateKey());
  } catch (err) {
    console.warn('[dailyCredit] could not seed the daily marker:', err);
  }
}

// Dashboard mount, an app foreground and the scan gate can all fire within
// the same second. One in-flight claim serves every concurrent caller so the
// read-then-write below cannot double-grant.
let inFlight: Promise<DailyCreditResult> | null = null;

/**
 * Grant today's free credit if it is due. Rules:
 *   - never for Pro (they have a daily quota already)
 *   - at most once per local calendar day per device
 *   - tops the balance up to 1; a balance that already has a match in hand
 *     consumes the day without granting, so free credits never accumulate
 * Never throws. `nextAt` is always the next local midnight, whether or not
 * anything was granted.
 */
export async function claimDailyCreditIfDue(
  isPro: boolean,
  isAuthenticated: boolean
): Promise<DailyCreditResult> {
  if (inFlight) return inFlight;
  inFlight = claimDailyCredit(isPro, isAuthenticated).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function claimDailyCredit(isPro: boolean, isAuthenticated: boolean): Promise<DailyCreditResult> {
  const nextAt = nextLocalMidnight();
  try {
    if (isPro) return { granted: false, nextAt };

    const key = await storageKey();
    const lastGrantedOn = await SecureStore.getItemAsync(key);
    const today = localDateKey();
    if (lastGrantedOn === today) return { granted: false, nextAt };

    const balance = isAuthenticated ? await getUserCredits() : await getLocalCredits();
    if (balance > 0) {
      // Already holding a match, so today's is effectively in hand. Marking
      // the day is the whole point of the rule: spending that credit an hour
      // from now must not hand out another one today.
      await SecureStore.setItemAsync(key, today).catch(() => {});
      return { granted: false, nextAt };
    }

    // Mark first, grant second (same order as the starter-credit grant) so a
    // crash between the two costs the user one credit rather than handing out
    // several. A failed write below restores the previous marker.
    await SecureStore.setItemAsync(key, today);

    const ok = isAuthenticated
      ? await updateUserCredits(balance + 1)
      : await addLocalCredits(1);

    if (!ok) {
      if (lastGrantedOn) {
        await SecureStore.setItemAsync(key, lastGrantedOn).catch(() => {});
      } else {
        await SecureStore.deleteItemAsync(key).catch(() => {});
      }
      return { granted: false, nextAt };
    }

    trackEvent('daily_credit_claimed', { is_authenticated: isAuthenticated });
    console.log(`[dailyCredit] granted today's free match (${isAuthenticated ? 'account' : 'guest'})`);
    return { granted: true, nextAt };
  } catch (err) {
    console.warn('[dailyCredit] claim failed:', err);
    return { granted: false, nextAt };
  }
}
