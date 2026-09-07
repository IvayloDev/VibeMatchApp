import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';
import { logOutUser } from './revenuecat';
import { getDeviceId } from './utils/freeCredits';

/**
 * Every unsuffixed SecureStore key the app writes.
 *
 * SecureStore has no enumerate API, so this list is maintained by hand. If you
 * add a SecureStore key, add it here or a reset will silently leave it behind.
 */
const SECURE_KEYS = [
  'tunematch_device_id',
  'tunematch_onboarding_complete',
  'tunematch_guest_onboarding_complete',
  'tunematch_had_account',
  'tunematch_results_paywall_shown',
  'tunematch_review_asked',
  'tunematch_match_success_count',
  'tunematch_notif_perm_requested',
  'tunematch_spotify_access_token',
  'tunematch_spotify_refresh_token',
  'tunematch_spotify_expires_at',
  'tunematch_spotify_display_name',
  // Legacy / unsuffixed variants, harmless if absent.
  'tunematch_free_credits_granted',
  'tunematch_guest_credits_granted',
  'tunematch_guest_free_credits_granted',
  'tunematch_registered_free_credits_granted',
];

/**
 * Keys suffixed with the device id. Computed before the device id is deleted.
 */
const DEVICE_SUFFIXED_PREFIXES = [
  'tunematch_guest_free_credits_granted_',
  'tunematch_daily_credit_last_',
];

/**
 * Put the app back to the state of a never-installed device.
 *
 * The interesting part is the free-credit marker. freeCredits.ts stores it as
 * `tunematch_guest_free_credits_granted_<deviceId>`, and SecureStore cannot
 * list keys, so the exact marker is not directly discoverable. Deleting
 * `tunematch_device_id` solves it anyway: the next launch mints a brand new
 * device id, which produces a brand new marker key, so the old marker is
 * orphaned and the grant fires again. That is precisely what a plain reinstall
 * fails to do, because the Keychain entry survives it.
 *
 * Debug-only. Callers must be behind DEBUG_TOOLS_ENABLED.
 */
export async function resetAppToFreshInstall(): Promise<{ ok: boolean; steps: string[] }> {
  const steps: string[] = [];

  // 1) Supabase session first, so nothing re-reads a signed-in user mid-wipe.
  let hadSession = false;
  try {
    const { data } = await supabase.auth.getSession();
    hadSession = !!data?.session;
    if (hadSession) {
      await supabase.auth.signOut();
      steps.push('signed out');
    } else {
      steps.push('was already a guest');
    }
  } catch {
    steps.push('sign out failed');
  }

  // 2) RevenueCat back to a fresh anonymous app user id, but ONLY if it was
  //    identified. Calling logOut while already anonymous is an error in the
  //    SDK, and a guest is anonymous by definition - attempting it just prints
  //    a scary "Error logging out" in the console for no reason.
  if (hadSession) {
    try {
      await logOutUser();
      steps.push('revenuecat logged out');
    } catch {
      steps.push('revenuecat logout failed');
    }
  } else {
    steps.push('revenuecat already anonymous');
  }

  // 3) Everything in AsyncStorage: credits, guest history, taste profile (the
  //    picked artists, genres and decades), pro cache, pro daily counters and
  //    the scheduled-notification id lists.
  try {
    await AsyncStorage.clear();
    steps.push('asyncstorage cleared');
  } catch {
    steps.push('asyncstorage clear failed');
  }

  // 4) SecureStore, including the suffixed markers we can still compute while
  //    the device id exists.
  try {
    let suffixed: string[] = [];
    try {
      const deviceId = await getDeviceId();
      const sanitized = deviceId.replace(/[^a-zA-Z0-9._-]/g, '_');
      suffixed = DEVICE_SUFFIXED_PREFIXES.map((prefix) => `${prefix}${sanitized}`);
    } catch {
      // No device id to compute from - rotating the id below is enough.
    }
    await Promise.all(
      [...SECURE_KEYS, ...suffixed].map((key) =>
        SecureStore.deleteItemAsync(key).catch(() => {})
      )
    );
    steps.push('securestore cleared');
  } catch {
    steps.push('securestore clear failed');
  }

  return { ok: true, steps };
}
