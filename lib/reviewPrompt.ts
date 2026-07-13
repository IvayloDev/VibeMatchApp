import * as SecureStore from 'expo-secure-store';
import * as StoreReview from 'expo-store-review';

/**
 * In-app review prompt gating.
 *
 * Strategy: fire the native rating sheet ONCE, after the user's 2nd
 * successful (fresh) song match — proven value, minimal nag. The OS also
 * hard-throttles requestReview() (iOS ≤3/365d), but we gate ourselves so
 * we never spend that quota on first-time users and never re-ask.
 *
 * Keys follow the existing `tunematch_` SecureStore convention
 * (see ONBOARDING_KEY / HAD_ACCOUNT_KEY in lib/AuthContext.tsx).
 */
const SUCCESS_COUNT_KEY = 'tunematch_match_success_count';
const REVIEW_ASKED_KEY = 'tunematch_review_asked';

const ASK_AFTER_SUCCESSES = 2;

/**
 * Increment and persist the count of successful fresh matches.
 * Call ONLY from the live match success path (never on history re-view).
 * Returns the new count. Never throws.
 */
export async function recordSuccessfulMatch(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(SUCCESS_COUNT_KEY);
    const next = (parseInt(raw ?? '0', 10) || 0) + 1;
    await SecureStore.setItemAsync(SUCCESS_COUNT_KEY, String(next));
    return next;
  } catch (err) {
    console.warn('[reviewPrompt] recordSuccessfulMatch failed:', err);
    return 0;
  }
}

/**
 * If the user has reached the success threshold and hasn't been asked
 * before, show the native in-app review sheet (once ever). Never throws.
 */
export async function maybeRequestReview(): Promise<void> {
  try {
    const asked = await SecureStore.getItemAsync(REVIEW_ASKED_KEY);
    if (asked === 'true') return;

    const raw = await SecureStore.getItemAsync(SUCCESS_COUNT_KEY);
    const count = parseInt(raw ?? '0', 10) || 0;
    if (count < ASK_AFTER_SUCCESSES) return;

    const available = await StoreReview.isAvailableAsync();
    if (!available) return;

    await StoreReview.requestReview();
    // Mark asked regardless — the OS owns whether the sheet actually showed,
    // and we only ever want to attempt this once.
    await SecureStore.setItemAsync(REVIEW_ASKED_KEY, 'true');
    console.log('[reviewPrompt] requestReview() invoked');
  } catch (err) {
    console.warn('[reviewPrompt] maybeRequestReview failed:', err);
  }
}
