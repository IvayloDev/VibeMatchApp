import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

// Secure storage keys (no @ prefix - SecureStore doesn't allow it)
const GUEST_FREE_CREDITS_GRANTED_KEY = 'tunematch_guest_free_credits_granted';
const REGISTERED_FREE_CREDITS_GRANTED_KEY = 'tunematch_registered_free_credits_granted';
const DEVICE_ID_KEY = 'tunematch_device_id';

/**
 * Sanitize a string to only contain alphanumeric characters, ".", "-", and "_"
 * This is required for SecureStore keys
 */
function sanitizeKey(str: string): string {
  return str.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Free credit amounts. The same for everyone, on every build.
 *
 * Two, because onboarding ends in a scan: that first match spends one and
 * leaves exactly one in hand, so a new user finishes onboarding holding a
 * match they can spend on a photo they chose themselves rather than landing
 * straight on a paywall. After that it is one per day (lib/dailyCredit.ts),
 * granted at 09:00 local and never stacking.
 *
 * The EXPO_PUBLIC_TEST_CREDITS override is deliberately gone rather than left
 * unset. A build-time flag that inflates a starting balance is the same shape
 * as the holes closed this week, and the profile that carried it (device-test)
 * ships to a real device, so "it is only for testing" was one edited eas.json
 * away from being untrue.
 */
export const GUEST_FREE_CREDITS: number = 2;
export const REGISTERED_FREE_CREDITS: number = 2;

/**
 * Get or create a unique device ID
 * This ID persists across app reinstalls on iOS (stored in Keychain)
 * and helps prevent abuse
 */
export async function getDeviceId(): Promise<string> {
  try {
    // Try to get existing device ID from secure store
    let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    
    if (deviceId) {
      return deviceId;
    }
    
    // Generate a new device ID
    // Use application ID as base for uniqueness
    const appId = Application.applicationId || 'unknown';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    // Sanitize the device ID to only contain allowed characters
    deviceId = sanitizeKey(`${appId}_${timestamp}_${random}`);
    
    // Store in secure store (persists across reinstalls on iOS)
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    
    return deviceId;
  } catch (error) {
    console.error('Error getting device ID:', error);
    // Fallback to a simple ID if secure store fails (use underscores for compatibility)
    return sanitizeKey(`device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);
  }
}

/**
 * Check if guest free credits have been granted to this device
 * Uses device ID to prevent abuse across reinstalls
 */
export async function hasGuestFreeCreditsBeenGranted(): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();
    const sanitizedDeviceId = sanitizeKey(deviceId);
    const key = `${GUEST_FREE_CREDITS_GRANTED_KEY}_${sanitizedDeviceId}`;
    const granted = await SecureStore.getItemAsync(key);
    const isGranted = granted === 'true';
    if (isGranted) {
      console.log('🔍 Guest free credits check: Already granted for device:', deviceId);
    } else {
      console.log('🔍 Guest free credits check: Not yet granted for device:', deviceId);
    }
    return isGranted;
  } catch (error) {
    console.error('Error checking guest free credits:', error);
    // On error, assume NOT granted to be safe (but log the error)
    return false;
  }
}

/**
 * Mark guest free credits as granted for this device
 */
export async function markGuestFreeCreditsAsGranted(): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    const sanitizedDeviceId = sanitizeKey(deviceId);
    const key = `${GUEST_FREE_CREDITS_GRANTED_KEY}_${sanitizedDeviceId}`;
    await SecureStore.setItemAsync(key, 'true');
    console.log('✅ Guest free credits marked as granted for device:', deviceId);
  } catch (error) {
    console.error('Error marking guest free credits as granted:', error);
  }
}

/**
 * Check if registered free credits have been granted to this user
 * Uses user ID to prevent abuse
 */
export async function hasRegisteredFreeCreditsBeenGranted(userId: string): Promise<boolean> {
  try {
    const sanitizedUserId = sanitizeKey(userId);
    const key = `${REGISTERED_FREE_CREDITS_GRANTED_KEY}_${sanitizedUserId}`;
    const granted = await SecureStore.getItemAsync(key);
    return granted === 'true';
  } catch (error) {
    console.error('Error checking registered free credits:', error);
    return false;
  }
}

/**
 * Mark registered free credits as granted for this user
 */
export async function markRegisteredFreeCreditsAsGranted(userId: string): Promise<void> {
  try {
    const sanitizedUserId = sanitizeKey(userId);
    const key = `${REGISTERED_FREE_CREDITS_GRANTED_KEY}_${sanitizedUserId}`;
    await SecureStore.setItemAsync(key, 'true');
    console.log('✅ Registered free credits marked as granted for user:', userId);
  } catch (error) {
    console.error('Error marking registered free credits as granted:', error);
  }
}

/**
 * The two grant functions that lived here are gone.
 *
 * grantGuestFreeCredits added credits to AsyncStorage and
 * grantRegisteredFreeCredits wrote `current + N` to user_profiles. Both are
 * now claim_device_starter and claim_free_match_for on the server, reached
 * through session-bootstrap: the starter is rationed per DEVICE rather than
 * per account, which matters because identities became free to create, and
 * the client no longer names an amount at all.
 *
 * hasGuestFreeCreditsBeenGranted stays, purely as the local hint the server is
 * told about, so a device that already had its starter credits under the old
 * client does not receive them a second time on update day.
 */
