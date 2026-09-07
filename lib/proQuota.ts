import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Daily match quota for TuneMatch Pro subscribers.
 *
 * The subscription is sold as "10 song matches every day" (deliberately NOT
 * "unlimited" - a capped plan must not claim unlimited). This counter is the
 * cap. It is client-side and therefore tamperable; that is accepted for now
 * because the worst case is bounded OpenAI spend, and honest users are the
 * overwhelming majority. Server-side enforcement in recommend-songs is the
 * noted future hardening.
 *
 * Key is scoped to the match day, which starts at 09:00 local rather than
 * midnight, so the reset lands when someone is awake to use it. The reset is
 * implicit: the key simply names a different day once 09:00 passes.
 * Yesterday's key is deleted lazily to avoid unbounded storage growth.
 */
export const PRO_DAILY_LIMIT = 10;

const KEY_PREFIX = '@tunematch_pro_scans_';
const LAST_KEY_POINTER = '@tunematch_pro_scans_last_key';

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

function todayKey(): string {
  return `${KEY_PREFIX}${matchDayKey()}`;
}

/**
 * Milliseconds until the counter resets.
 *
 * There is no timer anywhere - the reset is implicit, because `todayKey()`
 * simply names a different key once 09:00 passes. This measures the distance
 * to that moment so the UI can say when.
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

/** Scans a pro subscriber has used today (0 on any read error). */
export async function getProScansToday(): Promise<number> {
  try {
    const key = todayKey();

    // Lazily clean up the previous day's counter.
    const lastKey = await AsyncStorage.getItem(LAST_KEY_POINTER);
    if (lastKey && lastKey !== key) {
      AsyncStorage.removeItem(lastKey).catch(() => {});
    }
    if (lastKey !== key) {
      AsyncStorage.setItem(LAST_KEY_POINTER, key).catch(() => {});
    }

    const stored = await AsyncStorage.getItem(key);
    const n = stored ? parseInt(stored, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Whether a pro subscriber may run another scan today. */
export async function canProScanToday(): Promise<boolean> {
  return (await getProScansToday()) < PRO_DAILY_LIMIT;
}

/**
 * Record one pro scan. Called at the same point the credit path deducts a
 * credit, so a failed scan is never counted.
 */
export async function recordProScan(): Promise<void> {
  try {
    const key = todayKey();
    const current = await getProScansToday();
    await AsyncStorage.setItem(key, String(current + 1));
  } catch {
    // Losing one count is preferable to blocking the scan.
  }
}
