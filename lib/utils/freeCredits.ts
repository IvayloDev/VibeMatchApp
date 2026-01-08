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

// Free credit amounts
export const GUEST_FREE_CREDITS = 1;
export const REGISTERED_FREE_CREDITS = 3;

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
 * Grant free credits to guest user (one-time only)
 */
export async function grantGuestFreeCredits(): Promise<boolean> {
  try {
    // Check if already granted FIRST
    const alreadyGranted = await hasGuestFreeCreditsBeenGranted();
    if (alreadyGranted) {
      console.log('⚠️ Guest free credits already granted for this device - skipping');
      return false;
    }
    
    // Check current credits before granting (for debugging)
    const { getLocalCredits } = await import('../credits');
    const currentCredits = await getLocalCredits();
    console.log(`🔍 Current local credits before grant: ${currentCredits}`);
    
    // Mark as granted BEFORE adding credits to prevent race conditions
    // This ensures we don't grant twice even if called multiple times
    await markGuestFreeCreditsAsGranted();
    
    // Double-check after marking (in case of race condition)
    const doubleCheck = await hasGuestFreeCreditsBeenGranted();
    if (!doubleCheck) {
      console.error('❌ Failed to mark credits as granted - aborting');
      return false;
    }
    
    // Import here to avoid circular dependencies
    const { addLocalCredits } = await import('../credits');
    const success = await addLocalCredits(GUEST_FREE_CREDITS);
    
    if (success) {
      const newCredits = await getLocalCredits();
      console.log(`✅ Granted ${GUEST_FREE_CREDITS} free credit(s) to guest user. New total: ${newCredits}`);
      return true;
    } else {
      // If adding credits failed, we should unmark (but this is unlikely)
      console.error('❌ Failed to add credits but already marked as granted');
      return false;
    }
  } catch (error) {
    console.error('Error granting guest free credits:', error);
    return false;
  }
}

/**
 * Grant free credits to registered user (one-time only)
 */
export async function grantRegisteredFreeCredits(userId: string): Promise<boolean> {
  try {
    // Check if already granted
    const alreadyGranted = await hasRegisteredFreeCreditsBeenGranted(userId);
    if (alreadyGranted) {
      console.log('⚠️ Registered free credits already granted for this user');
      return false;
    }
    
    // Import here to avoid circular dependencies
    const { getUserCredits, updateUserCredits } = await import('../credits');
    const currentCredits = await getUserCredits();
    const newCredits = currentCredits + REGISTERED_FREE_CREDITS;
    const success = await updateUserCredits(newCredits);
    
    if (success) {
      await markRegisteredFreeCreditsAsGranted(userId);
      console.log(`✅ Granted ${REGISTERED_FREE_CREDITS} free credit(s) to registered user`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error granting registered free credits:', error);
    return false;
  }
}

