import { supabase, isRefreshTokenError, handleAuthError, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CreditPackage {
  id: string;
  credits: number;
  price: string;
  productId: string;
}

export const creditPackages: CreditPackage[] = [
  { id: '1', credits: 5, price: '$0.99', productId: 'credits_5' },
  { id: '2', credits: 15, price: '$2.99', productId: 'credits_15' },
  { id: '3', credits: 50, price: '$7.99', productId: 'credits_50' }, // BEST VALUE
  { id: '4', credits: 120, price: '$14.99', productId: 'credits_120' },
];

export const creditProductIds = creditPackages.map((pkg) => pkg.productId);

// Free credit amounts live in ./utils/freeCredits (GUEST_FREE_CREDITS /
// REGISTERED_FREE_CREDITS), which is what actually grants them. Duplicates
// used to sit here unreferenced - FIRST_ANALYSIS_FREE in particular made free
// first scans look intentional, which is why the ungated onboarding path went
// unnoticed.

// Local storage key for credits (Apple 5.1.1 compliance - allow purchases without registration)
const LOCAL_CREDITS_KEY = '@tunematch_local_credits';
const LOCAL_PURCHASES_KEY = '@tunematch_local_purchases';
const PENDING_VALIDATIONS_KEY = '@tunematch_pending_validations';

// ============================================
// LOCAL CREDITS (for non-authenticated users)
// Apple Guideline 5.1.1 compliance
// ============================================

/**
 * The local-balance API is gone: getLocalCredits, setLocalCredits,
 * addLocalCredits, deductLocalCredits, storeLocalPurchase and
 * getLocalPurchases.
 *
 * A guest's balance is no longer a number on the device. Every install has a
 * Supabase identity, anonymous unless they sign up, and the balance lives in
 * user_profiles where only server-side functions can move it. The read-only
 * remains of the old storage live in lib/legacyRecovery.ts, which exists to
 * preserve evidence of guest purchases and never to grant from it.
 */

/**
 * Store a pending validation (purchase succeeded but validation failed)
 * This allows retrying validation later
 */
export async function storePendingValidation(transactionId: string, productId: string, credits: number): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_VALIDATIONS_KEY);
    const pending = stored ? JSON.parse(stored) : [];
    
    // Check if this transaction is already in pending list
    const exists = pending.some((p: any) => p.transactionId === transactionId);
    if (exists) {
      console.log(`⚠️ Pending validation already exists for transaction: ${transactionId}`);
      return;
    }
    
    pending.push({
      transactionId,
      productId,
      credits,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    });
    
    await AsyncStorage.setItem(PENDING_VALIDATIONS_KEY, JSON.stringify(pending));
    console.log(`📋 Stored pending validation: ${productId} (${credits} credits) - Transaction: ${transactionId}`);
  } catch (error) {
    console.error('Error storing pending validation:', error);
  }
}

/**
 * Get all pending validations
 */
export async function getPendingValidations(): Promise<Array<{transactionId: string, productId: string, credits: number, timestamp: string, retryCount: number}>> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_VALIDATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error getting pending validations:', error);
    return [];
  }
}

/**
 * Remove a pending validation (after successful validation)
 */
export async function removePendingValidation(transactionId: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_VALIDATIONS_KEY);
    if (!stored) return;
    
    const pending = JSON.parse(stored);
    const filtered = pending.filter((p: any) => p.transactionId !== transactionId);
    await AsyncStorage.setItem(PENDING_VALIDATIONS_KEY, JSON.stringify(filtered));
    console.log(`✅ Removed pending validation for transaction: ${transactionId}`);
  } catch (error) {
    console.error('Error removing pending validation:', error);
  }
}

/**
 * Update retry count for a pending validation
 */
export async function updatePendingValidationRetry(transactionId: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_VALIDATIONS_KEY);
    if (!stored) return;
    
    const pending = JSON.parse(stored);
    const updated = pending.map((p: any) => 
      p.transactionId === transactionId 
        ? { ...p, retryCount: (p.retryCount || 0) + 1, lastRetry: new Date().toISOString() }
        : p
    );
    await AsyncStorage.setItem(PENDING_VALIDATIONS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Error updating pending validation retry:', error);
  }
}

/**
 * mergeLocalCreditsToAccount and clearLocalCredits used to live here.
 *
 * The merge added a device-authored number to a real account and then deleted
 * the local keys, including on the branch where it merged nothing. That delete
 * destroyed the only record that a guest pack sale had happened, and the
 * number it trusted came from a file the device controls.
 *
 * Both are replaced by supabase/functions/recover-legacy-purchases, which
 * grants only what RevenueCat corroborates, keyed to RevenueCat's own
 * transaction ids, and never clears anything itself. Nothing in the app
 * deletes @tunematch_local_purchases any more, in this release or a later one.
 */

/**
 * getUserCredits, updateUserCredits, deductCredits, refundCredits and
 * grantCreditsForProduct are gone.
 *
 * They were the whole client-side credit authority: read a number, do
 * arithmetic on it, write the result back. Every one of them could be wrong in
 * a way that cost a real user real credits - a failed read returning 0 became
 * an absolute write, and the deduct's retry re-sent a stale value over a
 * purchase that had landed in between.
 *
 * Reading is lib/creditState.ts, fed by get_credit_state() and by the balance
 * every scan response carries. Writing is charge_scan, refund_scan,
 * claim_free_match_for, claim_device_starter and grant_purchase_credits, none
 * of which a client can call.
 */

export function getCreditsForProduct(productId: string): number | null {
  const match = creditPackages.find((pkg) => pkg.productId === productId);
  return match ? match.credits : null;
}

// grantCreditsForProduct is gone with the rest: it read a balance and wrote
// back the sum, from the client, for a purchase nobody had verified.
