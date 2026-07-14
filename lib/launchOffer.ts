import * as SecureStore from 'expo-secure-store';
import { getDeviceId } from './utils/freeCredits';

// Launch offer duration: 30 minutes
export const LAUNCH_OFFER_DURATION_MS = 30 * 60 * 1000;

// SecureStore key prefix (no @ prefix - SecureStore doesn't allow it)
const LAUNCH_OFFER_STARTED_KEY = 'tunematch_launch_offer_started';

// Bonus credits per product id while the launch offer is active
export const OFFER_BONUS: Record<string, number> = {
  tunematch_credits_5: 3,
  tunematch_credits_18: 7,
  tunematch_credits_60: 15,
  tunematch_credits_150: 30,
};

/**
 * Get the launch offer bonus credits for a product id.
 * Returns 0 for unknown products.
 */
export function getOfferBonus(productId: string): number {
  return OFFER_BONUS[productId] || 0;
}

async function getOfferKey(): Promise<string> {
  const deviceId = await getDeviceId();
  return `${LAUNCH_OFFER_STARTED_KEY}_${deviceId}`;
}

/**
 * Start the 30-minute launch offer for this device.
 * One-time only per device (shared between guest and registered usage) -
 * no-op if the offer was already started.
 */
export async function startLaunchOffer(): Promise<void> {
  try {
    const key = await getOfferKey();
    const existing = await SecureStore.getItemAsync(key);
    if (existing) {
      // Already started on this device - never restart
      return;
    }
    await SecureStore.setItemAsync(key, String(Date.now()));
    console.log('🚀 Launch offer started for this device');
  } catch (error) {
    console.error('Error starting launch offer:', error);
  }
}

/**
 * Get the current launch offer state.
 * - Not started: { active: false, remainingMs: 0 }
 * - Started less than 30 minutes ago: { active: true, remainingMs }
 * - Expired (or clock rolled back before the start time): { active: false, remainingMs: 0 }
 * Never throws.
 */
export async function getLaunchOfferState(): Promise<{ active: boolean; remainingMs: number }> {
  try {
    const key = await getOfferKey();
    const stored = await SecureStore.getItemAsync(key);
    if (!stored) {
      return { active: false, remainingMs: 0 };
    }

    const started = parseInt(stored, 10);
    if (!Number.isFinite(started)) {
      return { active: false, remainingMs: 0 };
    }

    const now = Date.now();
    if (now < started) {
      // Clock rolled back - treat as expired to prevent abuse
      return { active: false, remainingMs: 0 };
    }

    const elapsed = now - started;
    if (elapsed < LAUNCH_OFFER_DURATION_MS) {
      return { active: true, remainingMs: LAUNCH_OFFER_DURATION_MS - elapsed };
    }

    return { active: false, remainingMs: 0 };
  } catch (error) {
    console.error('Error reading launch offer state:', error);
    return { active: false, remainingMs: 0 };
  }
}
