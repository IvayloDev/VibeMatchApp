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
 * Key is date-scoped (local time), so the reset is simply "the key changes at
 * local midnight". Yesterday's key is deleted lazily on first use of a new day
 * to avoid unbounded storage growth.
 */
export const PRO_DAILY_LIMIT = 10;

const KEY_PREFIX = '@tunematch_pro_scans_';
const LAST_KEY_POINTER = '@tunematch_pro_scans_last_key';

function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${KEY_PREFIX}${d.getFullYear()}-${m}-${day}`;
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
