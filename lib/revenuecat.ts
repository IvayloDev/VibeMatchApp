// Type-only imports - these don't trigger native module initialization
import type {
  PurchasesPackage,
  CustomerInfo,
  PurchasesOffering,
} from 'react-native-purchases';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Check if running in Expo Go by looking for expo-dev-client
// This MUST be checked before any module imports
function checkIfExpoGo(): boolean {
  try {
    // @ts-ignore - dynamic check
    const Constants = require('expo-constants').default;
    // Check multiple indicators of Expo Go
    const isExpo = Constants?.appOwnership === 'expo' || 
                   Constants?.executionEnvironment === 'storeClient' ||
                   (Constants?.executionEnvironment === 'standalone' && Constants?.appOwnership === 'expo');
    
    if (isExpo) {
      console.log('[RevenueCat] 🚫 Detected Expo Go - RevenueCat will be disabled. Use `npx expo run:ios` for full functionality.');
      return true;
    }
    return false;
  } catch (e) {
    // expo-constants not available, check other indicators
    try {
      // @ts-ignore
      if (global.__expo) {
        console.log('[RevenueCat] 🚫 Detected Expo Go via global.__expo');
        return true;
      }
    } catch {
      // Not Expo Go
    }
    return false;
  }
}

// Check if native module is actually available
function checkNativeModuleAvailable(): boolean {
  try {
    // Try to access the native module directly
    const { NativeModules } = require('react-native');
    const PurchasesModule = NativeModules?.RNPurchases;
    
    // If the native module doesn't exist, we're likely in Expo Go
    if (!PurchasesModule) {
      return false;
    }
    
    return true;
  } catch (e) {
    // If we can't check, assume it's not available
    return false;
  }
}

// Check immediately and cache result
let isExpoGo = checkIfExpoGo();

// Try to import the module directly (works in dev builds)
let Purchases: any = null;
let LOG_LEVEL: any = null;
let moduleImported = false;

// NEVER try to import in Expo Go - it will cause errors
// Also check if native module is available
if (!isExpoGo && checkNativeModuleAvailable()) {
  try {
    const PurchasesModule = require('react-native-purchases');
    if (PurchasesModule) {
      // react-native-purchases might export Purchases directly or as default
      if (typeof PurchasesModule.configure === 'function') {
        Purchases = PurchasesModule;
      } else if (PurchasesModule.default && typeof PurchasesModule.default.configure === 'function') {
        Purchases = PurchasesModule.default;
      } else if (PurchasesModule.Purchases && typeof PurchasesModule.Purchases.configure === 'function') {
        Purchases = PurchasesModule.Purchases;
      } else {
        Purchases = PurchasesModule.default || PurchasesModule;
      }
      
      LOG_LEVEL = PurchasesModule.LOG_LEVEL || null;
      moduleImported = true;
    }
  } catch (error: any) {
    // Silent fail - will try lazy loading later
    // If it's a native module error, mark as Expo Go
    if (error?.message?.includes('NativeEventEmitter') || 
        error?.message?.includes('native module') ||
        error?.message?.includes('null argument')) {
      console.warn('[RevenueCat] 🚫 Native module not available - likely running in Expo Go');
      isExpoGo = true;
    }
    moduleImported = false;
  }
} else {
  // In Expo Go or native module not available, mark as not imported and don't try
  if (!isExpoGo && !checkNativeModuleAvailable()) {
    console.warn('[RevenueCat] 🚫 Native module not available - likely running in Expo Go. Use `npx expo run:ios` for full functionality.');
    isExpoGo = true; // Treat as Expo Go if native module isn't available
  }
  moduleImported = false;
}

// Lazy load the module as fallback (skip in Expo Go)
async function loadPurchasesModule(retries = 3): Promise<boolean> {
  // Re-check Expo Go status (in case it wasn't detected initially)
  try {
    const Constants = require('expo-constants').default;
    const currentlyExpoGo = Constants?.appOwnership === 'expo' || 
                            Constants?.executionEnvironment === 'storeClient';
    if (currentlyExpoGo) {
      isExpoGo = true;
      console.warn('[RevenueCat] ⚠️ Detected Expo Go during module load - skipping. Use `npx expo run:ios` for full functionality.');
      return false;
    }
  } catch {
    // expo-constants not available
  }
  
  // Check if native module is available
  if (!checkNativeModuleAvailable()) {
    console.warn('[RevenueCat] ⚠️ Native module not available - likely running in Expo Go. Use `npx expo run:ios` for full functionality.');
    isExpoGo = true;
    return false;
  }
  
  if (Purchases) return true; // Already loaded
  
  // Skip in Expo Go - native modules don't work there
  if (isExpoGo) {
    console.warn('[RevenueCat] ⚠️ Running in Expo Go - RevenueCat is disabled. Use `npx expo run:ios` for full functionality.');
    return false;
  }
  
  // If direct import already worked, we're done
  if (Purchases && typeof Purchases.configure === 'function') {
    return true;
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Re-check Expo Go before each attempt
    try {
      const Constants = require('expo-constants').default;
      const currentlyExpoGo = Constants?.appOwnership === 'expo' || 
                              Constants?.executionEnvironment === 'storeClient';
      if (currentlyExpoGo) {
        isExpoGo = true;
        console.warn(`[RevenueCat] ⚠️ Detected Expo Go (attempt ${attempt}) - stopping module load`);
        return false;
      }
    } catch {
      // expo-constants not available, continue
    }
    
    // Re-check native module availability
    if (!checkNativeModuleAvailable()) {
      console.warn(`[RevenueCat] ⚠️ Native module not available (attempt ${attempt}) - stopping module load`);
      isExpoGo = true;
      return false;
    }
    
    try {
      const module: any = await import('react-native-purchases');
      
      // Find the Purchases object - might be default export, named export, or the module itself
      if (typeof module.configure === 'function') {
        Purchases = module;
      } else if (module.default && typeof module.default.configure === 'function') {
        Purchases = module.default;
      } else if (module.Purchases && typeof module.Purchases.configure === 'function') {
        Purchases = module.Purchases;
      } else if (module.default) {
        Purchases = module.default;
      }
      
      LOG_LEVEL = module.LOG_LEVEL || null;
      
      // Verify the module has the required methods
      if (Purchases && typeof Purchases.configure === 'function') {
        // Double-check that native module is actually working
        try {
          // Try to access a native method to verify bridge is ready
          if (typeof Purchases.configure === 'function') {
            return true;
          }
        } catch (nativeError: any) {
          // If we get a native error, the module isn't actually available
          if (nativeError?.message?.includes('NativeEventEmitter') || 
              nativeError?.message?.includes('null argument')) {
            console.warn(`[RevenueCat] Native module error detected (attempt ${attempt}):`, nativeError?.message);
            isExpoGo = true;
            return false;
          }
        }
        return true;
      } else {
        console.warn(`[RevenueCat] Module loaded but configure method missing (attempt ${attempt})`);
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.warn(`[RevenueCat] Failed to load module (attempt ${attempt}/${retries}):`, errorMsg);
      
      // If it's a native module error, mark as Expo Go and stop trying
      if (errorMsg.includes('NativeEventEmitter') || 
          errorMsg.includes('null argument') ||
          errorMsg.includes('native module')) {
        console.warn('[RevenueCat] 🚫 Native module error - likely running in Expo Go. Use `npx expo run:ios` for full functionality.');
        isExpoGo = true;
        return false;
      }
      
      // Wait before retrying (exponential backoff)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      }
    }
  }
  
  console.error('[RevenueCat] ❌ Failed to load module after all retries');
  return false;
}

// RevenueCat API Keys - Platform specific
// Get these from RevenueCat Dashboard → API Keys
const REVENUECAT_API_KEY_IOS = 'appl_FbkedPZAsBZxjJGeQjILDpPuWfZ';
const REVENUECAT_API_KEY_ANDROID = 'goog_xfDWGsTRQIIlkHlNaaThRjEechf';

// Use the appropriate key based on platform
const REVENUECAT_API_KEY = Platform.OS === 'ios' 
  ? REVENUECAT_API_KEY_IOS 
  : REVENUECAT_API_KEY_ANDROID;

/**
 * RevenueCat Configuration for Production/Apple Review
 * 
 * CURRENTLY ENABLED: RevenueCat is active in both development and production.
 * This is the correct setting for Apple App Review and production use.
 * 
 * IMPORTANT: For this to work, your RevenueCat Offering must use App Store products,
 * NOT Test Store products. The iOS SDK can only fetch real App Store products.
 * 
 * To configure:
 * 1. Go to RevenueCat Dashboard → Offerings → "default"
 * 2. Edit each package and link to App Store products (PalTech App Store)
 * 3. Ensure App Store products are created and active in App Store Connect
 */
// Enable RevenueCat for real environment testing
// Set to false to test real purchases in development
const SKIP_REVENUECAT_IN_DEV = false; // Enabled for real environment testing

// LEGACY credit packs. Not sold by this build (the paywall sells the pro
// subscription from the pro_v1 offering), but old builds still buy these from
// the untouched `default` offering, and validate-purchase keeps a copy of this
// table. Kept as documentation of what those products granted.
export const CREDITS_PER_PRODUCT: Record<string, number> = {
  'tunematch_credits_5': 5,
  'tunematch_credits_18': 18,    // 15 + 3 bonus
  'tunematch_credits_60': 60,    // 50 + 10 bonus
  'tunematch_credits_150': 150,  // 120 + 30 bonus
};

let isConfigured = false;
let isInitializing = false;
let currentAppUserId: string | null = null; // Track the currently identified user

// ---------------------------------------------------------------------------
// TuneMatch Pro subscription
// ---------------------------------------------------------------------------

/** Entitlement id configured in the RevenueCat dashboard. */
export const PRO_ENTITLEMENT_ID = 'pro';

/**
 * The new build fetches this offering EXPLICITLY by id, never
 * `offerings.current`. `current` still points at the legacy credit-pack
 * offering so builds <= 1.0.15 keep rendering the packs they understand; a
 * subscription product surfacing there would show as a broken "0 Credits" card
 * whose purchase charges the user and grants nothing.
 */
export const PRO_OFFERING_ID = 'pro_v1';

/**
 * Two-tier cache for the pro entitlement so scan gates stay fast and work
 * before the SDK finishes its (retried, ~1s-delayed) configuration:
 *   tier 1: module variable, process lifetime
 *   tier 2: AsyncStorage, survives cold start
 * When the SDK is reachable it is always asked (it maintains its own on-disk
 * cache offline); the tiers only answer while it is not configured yet.
 * Stale-allow is the deliberate failure mode: a free scan for a just-lapsed
 * subscriber costs less than blocking a paying one.
 */
const PRO_STATUS_STORAGE_KEY = '@tunematch_has_pro';
let lastKnownProStatus: boolean | null = null;
let proStatusListenerRegistered = false;

/**
 * Check if RevenueCat is available and ready
 */
function isRevenueCatAvailable(): boolean {
  try {
    if (!Purchases) {
      return false;
    }
    // Purchases can be an object or function depending on how the module exports it
    if (typeof Purchases !== 'object' && typeof Purchases !== 'function') {
      return false;
    }
    
    // If already configured, we can trust it's ready
    if (isConfigured) {
      return true;
    }
    
    // Before configuration, check for configure method
    if (typeof Purchases.configure === 'function') {
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn('[RevenueCat] Error checking availability:', error);
    return false;
  }
}

/**
 * Wait for native bridge to be ready by checking if we can actually call methods
 */
async function waitForNativeBridge(maxWaitMs = 5000): Promise<boolean> {
  if (!Purchases) return false;
  
  const startTime = Date.now();
  const checkInterval = 200;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Try to access a native method - if it throws, bridge isn't ready
      if (typeof Purchases.configure === 'function') {
        // Try to check if it's actually callable (native bridge ready)
        // We can't actually call it yet, but we can check if it exists
        // The real test will be when we try to configure
        return true;
      }
    } catch (error) {
      // Bridge not ready yet
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  return false;
}

/**
 * Initialize RevenueCat SDK
 * Call this once when the app starts
 */
export async function initRevenueCat(userId?: string): Promise<void> {
  // Skip RevenueCat entirely in development if configured
  if (SKIP_REVENUECAT_IN_DEV) {
    console.log('[RevenueCat] ℹ️ Skipping initialization - SKIP_REVENUECAT_IN_DEV is enabled');
    console.log('[RevenueCat] 💡 The app will use mock packages. Set SKIP_REVENUECAT_IN_DEV to false to test real purchases.');
    return;
  }

  try {
    // Re-check Expo Go status (in case it wasn't detected initially)
    const currentlyExpoGo = checkIfExpoGo();
    if (currentlyExpoGo || isExpoGo) {
      console.log('[RevenueCat] 🚫 Skipping initialization - running in Expo Go. Use `npx expo run:ios` for full functionality.');
      return;
    }
    
    // Check if native module is available before proceeding
    if (!checkNativeModuleAvailable()) {
      console.warn('[RevenueCat] 🚫 Native module not available - skipping initialization. Use `npx expo run:ios` for full functionality.');
      isExpoGo = true; // Mark as Expo Go to prevent further attempts
      return;
    }
    
    // Prevent multiple simultaneous initializations
    if (isInitializing) {
      // Wait for current initialization to complete
      let waitCount = 0;
      while (isInitializing && waitCount < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      if (isConfigured) {
        if (userId) {
          await identifyUser(userId);
        }
        return;
      }
    }

    if (isConfigured) {
      // If already configured and we have a new user, just identify them
      if (userId) {
        await identifyUser(userId);
      }
      return;
    }

    isInitializing = true;

    try {
      // Double-check Expo Go before attempting to load
      if (isExpoGo) {
        console.log('[RevenueCat] 🚫 Skipping module load - confirmed Expo Go');
        isInitializing = false;
        return;
      }
      
      // Double-check native module availability
      if (!checkNativeModuleAvailable()) {
        console.warn('[RevenueCat] 🚫 Native module not available - skipping module load');
        isExpoGo = true;
        isInitializing = false;
        return;
      }
    
    // Load the module first with retries
    const moduleLoaded = await loadPurchasesModule(5);
    
    if (!moduleLoaded) {
      console.warn('[RevenueCat] Could not load native module');
      isInitializing = false;
      return;
    }
    
    // Load module if not already loaded
    if (!moduleImported) {
      const moduleLoaded = await loadPurchasesModule(3);
      if (!moduleLoaded) {
        console.warn('[RevenueCat] Could not load module');
        isInitializing = false;
        return;
      }
    }
    
    // Wait for native bridge - try multiple times with increasing delays
    let configured = false;
    const maxAttempts = 15;
    const baseDelay = 200;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Wait before attempting (longer wait for later attempts)
      if (attempt > 1) {
        const delay = baseDelay * Math.min(attempt, 5); // Max 1 second delay
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      try {
        // Check if Purchases exists
        if (!Purchases) {
          continue;
        }
        
        // Check if configure exists
        if (typeof Purchases.configure !== 'function') {
          continue;
        }

        // Validate API key before configuring
        if (!REVENUECAT_API_KEY || REVENUECAT_API_KEY.includes('YOUR_') || REVENUECAT_API_KEY.includes('_HERE')) {
          console.error('[RevenueCat] ❌ Invalid API key detected:', REVENUECAT_API_KEY);
          console.error('[RevenueCat] 💡 Please add your Android API key (goog_...) to lib/revenuecat.ts');
          console.error('[RevenueCat] 📍 Find it in RevenueCat Dashboard → Project Settings → API Keys');
          throw new Error('Invalid RevenueCat API key - please add your Android API key');
        }

        // Try to configure
        Purchases.configure({
          apiKey: REVENUECAT_API_KEY,
          appUserID: userId || undefined,
        });
        
        console.log('[RevenueCat] ✅ Configured successfully with platform:', Platform.OS);

        // Track the user ID if provided during configuration
        if (userId) {
          currentAppUserId = userId;
        }

        // Set log level BEFORE any SDK operations to minimize noise
        // Note: ERROR logs about "no products registered" are expected during development
        // because Test Store products in RevenueCat don't work with the iOS SDK.
        // The iOS SDK only works with real App Store products.
        // These errors can be safely ignored - the app falls back to mock packages.
        if (LOG_LEVEL && Purchases.setLogLevel) {
          try {
            // In development, use ERROR level to reduce noise (only critical errors)
            // In production, use WARN level
            const logLevel = __DEV__ ? LOG_LEVEL.ERROR : LOG_LEVEL.WARN;
            Purchases.setLogLevel(logLevel);
          } catch (e) {
            // Ignore log level errors
          }
        }

        isConfigured = true;
        configured = true;
        break;
        
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        
        // If it's a NativeEventEmitter error, we're in Expo Go
        if (errorMsg.includes('NativeEventEmitter') || errorMsg.includes('null argument')) {
          console.warn('[RevenueCat] 🚫 Native module error during configuration - likely Expo Go');
          isExpoGo = true;
          isInitializing = false;
          return;
        }
        
        // If it's a native bridge error, keep trying
        if (errorMsg.includes('native') || errorMsg.includes('bridge') || errorMsg.includes('not ready')) {
          continue;
        }
        
        // Other errors might be fatal
        if (attempt === maxAttempts) {
          console.error('[RevenueCat] ❌ Configuration failed:', errorMsg);
        }
      }
    }
    
    if (!configured) {
      console.error('[RevenueCat] ❌ Could not configure after all attempts');
      console.warn('[RevenueCat] Make sure you rebuilt the app after installing react-native-purchases');
      return;
    }
    
    // Identify user if provided
    if (userId) {
      await identifyUser(userId);
    }

    // Warm the pro-status cache and keep it fresh for the lifetime of the
    // process. Renewals, purchases, restores and identity changes all emit
    // through this listener, so the scan gates never read stale state for
    // longer than the SDK itself does.
    if (!proStatusListenerRegistered) {
      proStatusListenerRegistered = true;
      refreshProStatus().catch(() => {});
      try {
        Purchases.addCustomerInfoUpdateListener((info: CustomerInfo) => {
          const isPro = !!info?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
          lastKnownProStatus = isPro;
          AsyncStorage.setItem(PRO_STATUS_STORAGE_KEY, isPro ? 'true' : 'false').catch(() => {});
        });
      } catch (listenerError) {
        console.warn('[RevenueCat] Could not register pro status listener:', listenerError);
      }
    }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error('[RevenueCat] ❌ Configuration error:', errorMsg);
      
      // If it's a native module error, mark as Expo Go
      if (errorMsg.includes('NativeEventEmitter') || 
          errorMsg.includes('null argument') ||
          errorMsg.includes('native module')) {
        console.warn('[RevenueCat] 🚫 Native module error - marking as Expo Go');
        isExpoGo = true;
      }
      // Don't throw - allow app to continue
    } finally {
      isInitializing = false;
    }
  } catch (error: any) {
    // Catch any unexpected errors to prevent app crash
    console.error('[RevenueCat] ❌ Unexpected initialization error:', error?.message || error);
    isExpoGo = true; // Mark as Expo Go to prevent further attempts
  }
}

/**
 * Identify user when they log in (links purchases to user account)
 */
/**
 * Make sure a subscription bought as a guest survives creating an account.
 *
 * A guest's purchase is attached to RevenueCat's ANONYMOUS app user id. Signing
 * up calls logIn() with the Supabase user id, and the entitlement has to move
 * across. When it does not, the app correctly reports "not pro" while the App
 * Store still says subscribed - the user has paid and lost access, which is the
 * worst failure this screen has.
 *
 * identifyUser() alone was not enough: it logs in and returns customerInfo, but
 * nothing re-read the entitlement afterwards, and nothing recovered the receipt
 * if the transfer did not happen. syncPurchases() re-sends the StoreKit receipt
 * under the now-identified id, which (with the project set to "Transfer to new
 * App User ID") reattaches the subscription.
 *
 * Safe to call on every sign-in: when the entitlement is already present it
 * costs one getCustomerInfo and returns immediately.
 */
export async function reconcileProAfterLogin(userId: string): Promise<boolean> {
  if (!isRevenueCatAvailable() || !isConfigured) return false;

  await identifyUser(userId);

  let isPro = await refreshProStatus();
  if (isPro) return true;

  // Not pro after logging in. If StoreKit still holds a receipt, resending it
  // attaches the purchase to this user id instead of the orphaned anonymous one.
  try {
    console.log('[RevenueCat] not pro after logIn - syncing purchases to recover a guest subscription');
    const info = await syncPurchases();
    isPro = await refreshProStatus(info);
    if (isPro) console.log('[RevenueCat] ✅ recovered entitlement via syncPurchases');
  } catch (error) {
    console.warn('[RevenueCat] syncPurchases during login reconcile failed:', error);
  }

  return isPro;
}

export async function identifyUser(userId: string): Promise<CustomerInfo | null> {
  if (!isRevenueCatAvailable() || !isConfigured) {
    console.warn('[RevenueCat] Not configured, skipping user identification');
    return null;
  }

  // Skip if already identified with the same user ID
  if (currentAppUserId === userId) {
    if (__DEV__) {
      console.log('[RevenueCat] ℹ️ User already identified, skipping logIn call');
    }
    // Return current customer info instead
    try {
      return await Purchases.getCustomerInfo();
    } catch (error) {
      // If getCustomerInfo fails, try logIn anyway
      console.warn('[RevenueCat] Could not get customer info, attempting logIn');
    }
  }

  try {
    const { customerInfo } = await Purchases.logIn(userId);
    currentAppUserId = userId; // Track the identified user
    return customerInfo;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    
    // If the error is about same user ID, that's fine - just get customer info
    if (errorMessage.includes('same as the one already cached') || 
        errorMessage.includes('same appUserID')) {
      currentAppUserId = userId; // Track as identified
      try {
        return await Purchases.getCustomerInfo();
      } catch (getInfoError) {
        console.warn('[RevenueCat] Could not get customer info after logIn warning');
        return null;
      }
    }
    
    console.error('[RevenueCat] Error identifying user:', error);
    return null;
  }
}

/**
 * Log out user (reset to anonymous)
 */
export async function logOutUser(): Promise<CustomerInfo | null> {
  if (!isRevenueCatAvailable() || !isConfigured) {
    return null;
  }

  try {
    const customerInfo = await Purchases.logOut();
    currentAppUserId = null; // Clear tracked user ID
    return customerInfo;
  } catch (error) {
    console.error('[RevenueCat] Error logging out:', error);
    currentAppUserId = null; // Clear tracked user ID even on error
    return null;
  }
}

/**
 * Get current customer info
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isRevenueCatAvailable() || !isConfigured) {
    return null;
  }

  try {
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.error('[RevenueCat] Error getting customer info:', error);
    return null;
  }
}


/**
 * Persist + broadcast the latest pro status. Accepts the customerInfo a
 * paywall callback already holds so no extra fetch is needed post-purchase.
 */
export async function refreshProStatus(customerInfo?: CustomerInfo | null): Promise<boolean> {
  let info = customerInfo ?? null;
  if (!info && isRevenueCatAvailable() && isConfigured) {
    info = await getCustomerInfo();
  }
  if (!info) {
    // Nothing fresh to learn - fall back to what we knew.
    return hasProEntitlement();
  }
  const isPro = !!info.entitlements?.active?.[PRO_ENTITLEMENT_ID];
  lastKnownProStatus = isPro;
  AsyncStorage.setItem(PRO_STATUS_STORAGE_KEY, isPro ? 'true' : 'false').catch(() => {});
  return isPro;
}

/**
 * Does this user (signed-in or anonymous) have an active pro subscription?
 * Safe to call before the SDK is configured - see the cache note above.
 */
export async function hasProEntitlement(): Promise<boolean> {
  if (isRevenueCatAvailable() && isConfigured) {
    try {
      const info = await Purchases.getCustomerInfo();
      const isPro = !!info?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
      lastKnownProStatus = isPro;
      AsyncStorage.setItem(PRO_STATUS_STORAGE_KEY, isPro ? 'true' : 'false').catch(() => {});
      return isPro;
    } catch (error) {
      console.warn('[RevenueCat] pro check failed, using cached status:', error);
    }
  }
  if (lastKnownProStatus !== null) return lastKnownProStatus;
  try {
    const stored = await AsyncStorage.getItem(PRO_STATUS_STORAGE_KEY);
    lastKnownProStatus = stored === 'true';
    return lastKnownProStatus;
  } catch {
    return false;
  }
}

/**
 * Subscribe to pro-status changes (purchases, renewals, expirations, identity
 * changes all flow through the SDK's customerInfo listener). Returns an
 * unsubscribe function. Also keeps both cache tiers fresh.
 */
export function subscribeToProStatus(cb: (isPro: boolean) => void): () => void {
  return addCustomerInfoUpdateListener((info) => {
    const isPro = !!info.entitlements?.active?.[PRO_ENTITLEMENT_ID];
    lastKnownProStatus = isPro;
    AsyncStorage.setItem(PRO_STATUS_STORAGE_KEY, isPro ? 'true' : 'false').catch(() => {});
    cb(isPro);
  });
}

/**
 * Fetch the subscription offering for the paywall. Returns null when it cannot
 * be loaded - the caller shows an honest error/retry state, never mock data.
 */
export type ProPlanSummary = {
  productIdentifier: string;
  /** "Monthly" / "Annual", or the raw id if an unknown product ever appears. */
  planLabel: string;
  /** True while the store still intends to renew - false once cancelled. */
  willRenew: boolean;
  /** True during a free trial. */
  isTrial: boolean;
  expirationDate: string | null;
};

/**
 * Which plan the subscriber is actually on.
 *
 * The app gates purely on the `pro` entitlement, which both products grant, so
 * monthly and annual are deliberately identical in capability. That is correct,
 * but it also meant switching plans produced no visible change anywhere and
 * looked like the switch had failed. This is what lets the UI name the plan.
 */
export async function getProPlanSummary(): Promise<ProPlanSummary | null> {
  const info = await getCustomerInfo();
  const entitlement = info?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
  if (!entitlement) return null;

  const productIdentifier = entitlement.productIdentifier ?? '';
  // Match loosely: the Play ids carry a `:base-plan` suffix.
  const isAnnual = /annual|yearly|p1y/i.test(productIdentifier);
  const isMonthly = /monthly|p1m/i.test(productIdentifier);

  return {
    productIdentifier,
    planLabel: isAnnual ? 'Annual' : isMonthly ? 'Monthly' : productIdentifier || 'Pro',
    willRenew: !!entitlement.willRenew,
    isTrial: entitlement.periodType === 'TRIAL',
    expirationDate: entitlement.expirationDate ?? null,
  };
}

export async function getProOffering(): Promise<PurchasesOffering | null> {
  if (!isConfigured) {
    try {
      await initRevenueCat();
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.warn('[RevenueCat] Initialization attempt failed:', error);
    }
  }
  if (!isRevenueCatAvailable() || !isConfigured) {
    return null;
  }
  try {
    const offerings = await Purchases.getOfferings();
    const offering = offerings?.all?.[PRO_OFFERING_ID] ?? null;
    if (!offering || offering.availablePackages.length === 0) {
      console.warn(`[RevenueCat] Offering "${PRO_OFFERING_ID}" missing or empty`);
      return null;
    }
    return offering;
  } catch (error: any) {
    console.warn('[RevenueCat] Error fetching pro offering:', error?.message || error);
    return null;
  }
}

/**
 * Restore previous purchases
 * Note: For consumables, restore typically doesn't re-grant credits
 */
export async function restorePurchases(): Promise<{
  success: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
}> {
  if (!isRevenueCatAvailable() || !isConfigured) {
    return {
      success: false,
      error: 'RevenueCat not initialized',
    };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();
    
    return {
      success: true,
      customerInfo,
    };
  } catch (error: any) {
    console.error('[RevenueCat] Restore error:', error);
    return {
      success: false,
      error: error.message || 'Restore failed',
    };
  }
}

/**
 * Get subscription management URL (for iOS)
 */
export function getManagementURL(customerInfo: CustomerInfo): string | null {
  return customerInfo.managementURL;
}

/**
 * Listen for customer info updates
 */
export function addCustomerInfoUpdateListener(
  listener: (customerInfo: CustomerInfo) => void
): () => void {
  if (!isRevenueCatAvailable() || !isConfigured) {
    // Return no-op unsubscribe function
    return () => {};
  }

  Purchases.addCustomerInfoUpdateListener(listener);
  
  // Return unsubscribe function
  return () => {
    if (isRevenueCatAvailable()) {
      Purchases.removeCustomerInfoUpdateListener(listener);
    }
  };
}


/**
 * Sync purchases (useful after app update or reinstall)
 */
export async function syncPurchases(): Promise<CustomerInfo | null> {
  if (!isRevenueCatAvailable() || !isConfigured) {
    return null;
  }

  try {
    await Purchases.syncPurchases();
    // After syncing, get the updated customer info
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.error('[RevenueCat] Error syncing purchases:', error);
    return null;
  }
}
