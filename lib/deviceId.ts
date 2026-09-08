/**
 * The device's own id, unchanged from the one lib/utils/freeCredits.ts has
 * always written.
 *
 * It lives in the Keychain on iOS, so it survives a reinstall, and that is the
 * whole point: it is what stops the starter grant becoming a refill button now
 * that identities are free to create. Same SecureStore key, same value, so an
 * install that updates keeps the id it already had and cannot claim a second
 * starter.
 */
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';

const DEVICE_ID_KEY = 'tunematch_device_id';

/** SecureStore keys allow only alphanumerics, ".", "-" and "_". */
function sanitizeKey(str: string): string {
  return str.replace(/[^a-zA-Z0-9._-]/g, '_');
}

let inFlight: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = resolve().finally(() => { inFlight = null; });
  return inFlight;
}

async function resolve(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;

    const appId = Application.applicationId || 'unknown';
    const fresh = sanitizeKey(`${appId}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);
    await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch (error) {
    // A device id we cannot persist is worse than useless for rationing, but
    // the caller still needs a string. The server treats an unknown device as
    // one that has never claimed, so the only cost is that this launch could
    // claim a starter it may have had before. Rare enough to accept, and the
    // alternative is refusing to boot.
    console.error('[deviceId] could not read or write the keychain:', error);
    return sanitizeKey(`device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);
  }
}
