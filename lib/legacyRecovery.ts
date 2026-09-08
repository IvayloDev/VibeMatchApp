/**
 * The read-only half of legacy guest recovery.
 *
 * Everything here reads and nothing here deletes. That is the rule the whole
 * module exists to enforce: before this release a guest's balance was a number
 * in AsyncStorage and their receipts were a list beside it, and for anyone who
 * bought a pack as a guest, that list is the only evidence on earth that the
 * sale happened. The server grants from RevenueCat's record, never from these
 * numbers, and the keys are cleared only after the server confirms - and
 * `@tunematch_local_purchases` is never cleared at all, in this release or any
 * later one. It costs a few hundred bytes and it is what a support
 * conversation would be built on.
 *
 * captureLegacySnapshot() runs at boot before anything touches the network, so
 * the evidence is preserved even if the app is killed a second later.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getDeviceId } from './deviceId';

const LOCAL_CREDITS_KEY = '@tunematch_local_credits';
const LOCAL_PURCHASES_KEY = '@tunematch_local_purchases';
const SNAPSHOT_KEY = '@tunematch_legacy_snapshot_v1';
const RECOVERED_KEY = 'tunematch_legacy_recovery_v1';
const GUEST_STARTER_MARKER_PREFIX = 'tunematch_guest_free_credits_granted';

export type LegacyPurchase = {
  transactionId: string;
  productId: string;
  credits: number;
  timestamp?: string;
};

export type LegacySnapshot = {
  takenAt: string;
  localCredits: number;
  purchases: LegacyPurchase[];
  starterMarkerPresent: boolean;
  deviceId: string;
};

/** The old local balance. Read for reporting only; never granted from. */
export async function readLocalCredits(): Promise<number> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_CREDITS_KEY);
    return stored ? parseInt(stored, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/** The old receipt log. Never deleted. */
export async function readLocalPurchases(): Promise<LegacyPurchase[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_PURCHASES_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Has this device already been through recovery? */
export async function recoveryAlreadyDone(): Promise<boolean> {
  try {
    return !!(await SecureStore.getItemAsync(RECOVERED_KEY));
  } catch {
    return false;
  }
}

/** Did the old client already hand this device its starter credits? */
export async function starterMarkerPresent(): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();
    const key = `${GUEST_STARTER_MARKER_PREFIX}_${deviceId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return (await SecureStore.getItemAsync(key)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Preserve what this device believes it has, once, before anything can change
 * it. Written only if no snapshot exists: a second capture after a successful
 * recovery would read zeroes and overwrite the only record of what was there.
 */
export async function captureLegacySnapshot(): Promise<LegacySnapshot | null> {
  try {
    if (await recoveryAlreadyDone()) return null;

    const existing = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (existing) {
      try { return JSON.parse(existing) as LegacySnapshot; } catch { /* rewrite below */ }
    }

    const [localCredits, purchases] = await Promise.all([readLocalCredits(), readLocalPurchases()]);
    if (localCredits === 0 && purchases.length === 0) return null;

    const snapshot: LegacySnapshot = {
      takenAt: new Date().toISOString(),
      localCredits,
      purchases,
      starterMarkerPresent: await starterMarkerPresent(),
      deviceId: await getDeviceId(),
    };
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    console.log('[legacyRecovery] snapshot captured', {
      credits: localCredits, purchases: purchases.length,
    });
    return snapshot;
  } catch (error) {
    console.warn('[legacyRecovery] could not capture a snapshot:', error);
    return null;
  }
}

export async function peekSnapshot(): Promise<LegacySnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as LegacySnapshot) : null;
  } catch {
    return null;
  }
}

/**
 * Called ONLY after the server has reported a definite outcome.
 *
 * Order matters: the marker is written first, so a crash mid-way leaves a
 * device that will not try again rather than one that recovers twice. The
 * balance key goes, the snapshot goes, and the receipt log stays for ever.
 */
export async function markRecovered(uid: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(RECOVERED_KEY, `${uid}:${new Date().toISOString()}`);
    await AsyncStorage.removeItem(LOCAL_CREDITS_KEY);
    await AsyncStorage.removeItem(SNAPSHOT_KEY);
    console.log('[legacyRecovery] local balance cleared; the receipt log is kept deliberately');
  } catch (error) {
    console.warn('[legacyRecovery] could not finalise:', error);
  }
}
