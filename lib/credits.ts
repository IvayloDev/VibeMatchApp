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

// Free trial constants
export const FREE_CREDITS_ON_SIGNUP = 3;
export const FIRST_ANALYSIS_FREE = true;

// Local storage key for credits (Apple 5.1.1 compliance - allow purchases without registration)
const LOCAL_CREDITS_KEY = '@tunematch_local_credits';
const LOCAL_PURCHASES_KEY = '@tunematch_local_purchases';

// ============================================
// LOCAL CREDITS (for non-authenticated users)
// Apple Guideline 5.1.1 compliance
// ============================================

/**
 * Get credits stored locally on device (for non-authenticated users)
 */
export async function getLocalCredits(): Promise<number> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_CREDITS_KEY);
    return stored ? parseInt(stored, 10) : 0;
  } catch (error) {
    console.error('Error getting local credits:', error);
    return 0;
  }
}

/**
 * Set credits stored locally on device
 */
export async function setLocalCredits(credits: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(LOCAL_CREDITS_KEY, credits.toString());
    console.log(`💳 Local credits set to: ${credits}`);
    return true;
  } catch (error) {
    console.error('Error setting local credits:', error);
    return false;
  }
}

/**
 * Add credits locally (for non-authenticated purchases)
 */
export async function addLocalCredits(amount: number): Promise<boolean> {
  try {
    const current = await getLocalCredits();
    const newTotal = current + amount;
    await AsyncStorage.setItem(LOCAL_CREDITS_KEY, newTotal.toString());
    console.log(`💳 Local credits: ${current} + ${amount} = ${newTotal}`);
    return true;
  } catch (error) {
    console.error('Error adding local credits:', error);
    return false;
  }
}

/**
 * Deduct credits locally
 */
export async function deductLocalCredits(amount: number = 1): Promise<boolean> {
  try {
    const current = await getLocalCredits();
    if (current < amount) {
      console.warn(`⚠️ Not enough local credits: have ${current}, need ${amount}`);
      return false;
    }
    const newTotal = current - amount;
    await AsyncStorage.setItem(LOCAL_CREDITS_KEY, newTotal.toString());
    console.log(`💳 Local credits deducted: ${current} - ${amount} = ${newTotal}`);
    return true;
  } catch (error) {
    console.error('Error deducting local credits:', error);
    return false;
  }
}

/**
 * Store a local purchase record (for later sync if user registers)
 */
export async function storeLocalPurchase(transactionId: string, productId: string, credits: number): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_PURCHASES_KEY);
    const purchases = stored ? JSON.parse(stored) : [];
    purchases.push({
      transactionId,
      productId,
      credits,
      timestamp: new Date().toISOString(),
    });
    await AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(purchases));
    console.log(`📦 Stored local purchase: ${productId} (${credits} credits)`);
  } catch (error) {
    console.error('Error storing local purchase:', error);
  }
}

/**
 * Get all local purchases (for display or sync)
 */
export async function getLocalPurchases(): Promise<Array<{transactionId: string, productId: string, credits: number, timestamp: string}>> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_PURCHASES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error getting local purchases:', error);
    return [];
  }
}

/**
 * Merge local credits into user account when they register/sign in
 * This enables cross-device access as mentioned in Apple's guidelines
 */
export async function mergeLocalCreditsToAccount(): Promise<{ merged: boolean, creditsMerged: number }> {
  try {
    const localCredits = await getLocalCredits();
    const localPurchases = await getLocalPurchases();
    
    if (localCredits === 0 && localPurchases.length === 0) {
      return { merged: false, creditsMerged: 0 };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { merged: false, creditsMerged: 0 };
    }

    // Get current account credits
    const accountCredits = await getUserCredits();
    const totalCredits = accountCredits + localCredits;

    // Update account with merged credits
    const success = await updateUserCredits(totalCredits);
    
    if (success) {
      // Clear local storage after successful merge
      await AsyncStorage.removeItem(LOCAL_CREDITS_KEY);
      await AsyncStorage.removeItem(LOCAL_PURCHASES_KEY);
      console.log(`✅ Merged ${localCredits} local credits to account. New total: ${totalCredits}`);
      return { merged: true, creditsMerged: localCredits };
    }

    return { merged: false, creditsMerged: 0 };
  } catch (error) {
    console.error('Error merging local credits:', error);
    return { merged: false, creditsMerged: 0 };
  }
}

/**
 * Clear local credits (after merge or logout)
 */
export async function clearLocalCredits(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCAL_CREDITS_KEY);
    await AsyncStorage.removeItem(LOCAL_PURCHASES_KEY);
    console.log('🧹 Local credits cleared');
  } catch (error) {
    console.error('Error clearing local credits:', error);
  }
}

// Get user's current credits (supports both authenticated and non-authenticated users)
// Apple Guideline 5.1.1: Credits work without registration
export async function getUserCredits(): Promise<number> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      // AuthSessionMissingError is expected for logged out / guest users - don't log as error
      const isSessionMissing = userError.name === 'AuthSessionMissingError' || 
                               userError.message?.includes('Auth session missing');
      if (!isSessionMissing) {
        console.error('Auth error getting user:', userError);
      }
      // If user doesn't exist in JWT, clear the session
      if (isRefreshTokenError(userError) || userError.message?.includes('JWT does not exist')) {
        console.log('Invalid user session detected, clearing...');
        await handleAuthError(userError);
      }
      // Fall back to local credits for non-authenticated users
      return await getLocalCredits();
    }
    if (!user) {
      // Non-authenticated: return local credits
      return await getLocalCredits();
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('credits, user_id, updated_at')
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - user doesn't have a profile yet
        console.log(`📝 No profile found for user ${user.id}, creating one with ${FREE_CREDITS_ON_SIGNUP} credits`);
        // Create profile with default credits
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert({
            user_id: user.id,
            credits: FREE_CREDITS_ON_SIGNUP
          });
        
        if (insertError) {
          console.error('Error creating user profile:', insertError);
          return FREE_CREDITS_ON_SIGNUP;
        }
        
        return FREE_CREDITS_ON_SIGNUP;
      }
      console.error('❌ Error fetching credits:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return 0;
    }

    if (!data) {
      console.warn(`⚠️ No data returned for user ${user.id}, defaulting to ${FREE_CREDITS_ON_SIGNUP} credits`);
      return FREE_CREDITS_ON_SIGNUP;
    }

    console.log(`💳 Fetched credits for user ${user.id}: ${data.credits} (last updated: ${data.updated_at})`);
    return data.credits ?? FREE_CREDITS_ON_SIGNUP;
  } catch (error) {
    console.error('Error getting user credits:', error);
    if (isRefreshTokenError(error)) {
      await handleAuthError(error);
    }
    return FREE_CREDITS_ON_SIGNUP;
  }
}

// Update user's credits
export async function updateUserCredits(newCredits: number): Promise<boolean> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      // AuthSessionMissingError is expected for logged out / guest users - don't log as error
      const isSessionMissing = userError.name === 'AuthSessionMissingError' || 
                               userError.message?.includes('Auth session missing');
      if (!isSessionMissing) {
        console.error('Auth error getting user for credit update:', userError);
      }
      if (isRefreshTokenError(userError)) {
        await handleAuthError(userError);
      }
      return false;
    }
    if (!user) {
      console.error('No user found for credit update');
      return false;
    }

    console.log(`🔄 UPDATE: user.id = ${user.id}, newCredits = ${newCredits}`);
    
    // First, check what's in the database RIGHT NOW
    const { data: beforeData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    console.log('📊 BEFORE UPDATE - row in database:', JSON.stringify(beforeData));
    
    // Use direct UPDATE
    const { error: updateError, data: updateData, count } = await supabase
      .from('user_profiles')
      .update({ 
        credits: newCredits, 
        updated_at: new Date().toISOString() 
      })
      .eq('user_id', user.id)
      .select('*');
    
    console.log('📊 UPDATE result - error:', updateError, 'data:', JSON.stringify(updateData), 'count:', count);
    
    if (updateError) {
      console.error('❌ Direct UPDATE failed:', updateError);
      
      // Fallback: Try UPSERT
      console.log('⚠️ Fallback: Trying UPSERT...');
      const { error: upsertError, data: upsertData } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          credits: newCredits,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
        .select('*');
      
      console.log('📊 UPSERT result - error:', upsertError, 'data:', JSON.stringify(upsertData));
      
      if (upsertError) {
        console.error('❌ UPSERT also failed:', upsertError);
        return false;
      }
      
      return true;
    }
    
    // Check if any rows were actually updated
    if (!updateData || updateData.length === 0) {
      console.warn('⚠️ UPDATE returned no rows! Row might not exist. Trying UPSERT...');
      const { error: upsertError, data: upsertData } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          credits: newCredits,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
        .select('*');
      
      console.log('📊 UPSERT result - error:', upsertError, 'data:', JSON.stringify(upsertData));
      
      if (upsertError) {
        console.error('❌ UPSERT failed:', upsertError);
        return false;
      }
      
      return true;
    }

    // Verify by reading again
    const { data: afterData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    console.log('📊 AFTER UPDATE - row in database:', JSON.stringify(afterData));

    console.log(`✅ Credits updated: ${newCredits}, result:`, JSON.stringify(updateData));
    return true;
  } catch (error) {
    console.error('❌ Exception updating user credits:', error);
    if (isRefreshTokenError(error)) {
      await handleAuthError(error);
    }
    return false;
  }
}

// Deduct credits for analysis (supports both authenticated and non-authenticated users)
// Apple Guideline 5.1.1: Credits work without registration
export async function deductCredits(amount: number = 1): Promise<boolean> {
  try {
    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      // Non-authenticated: use local credits
      console.log(`💳 Deducting ${amount} credits from local storage`);
      return await deductLocalCredits(amount);
    }
    
    // Authenticated: use account credits
    const currentCredits = await getUserCredits();
    console.log(`💳 Current credits before deduction: ${currentCredits}, deducting: ${amount}`);
    
    if (currentCredits < amount) {
      console.warn(`⚠️ Not enough credits: have ${currentCredits}, need ${amount}`);
      return false; // Not enough credits
    }

    const newCredits = currentCredits - amount;
    console.log(`💳 Deducting credits: ${currentCredits} - ${amount} = ${newCredits}`);
    
    const success = await updateUserCredits(newCredits);
    
    if (!success) {
      console.error(`❌ Failed to update credits to ${newCredits}`);
      return false;
    }
    
    // Verify the deduction worked - wait a bit for DB to update
    await new Promise(resolve => setTimeout(resolve, 500));
    const verifyCredits = await getUserCredits();
    console.log(`✅ Credit deduction verified: ${verifyCredits} credits remaining (expected: ${newCredits})`);
    
    if (verifyCredits !== newCredits) {
      console.error(`❌ CREDIT DEDUCTION MISMATCH: Expected ${newCredits}, got ${verifyCredits}`);
      // Retry the update
      console.log('🔄 Retrying credit update...');
      const retrySuccess = await updateUserCredits(newCredits);
      if (retrySuccess) {
        // Verify again after retry
        await new Promise(resolve => setTimeout(resolve, 500));
        const finalVerify = await getUserCredits();
        console.log(`🔄 After retry, credits are: ${finalVerify} (expected: ${newCredits})`);
        return finalVerify === newCredits;
      }
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Exception deducting credits:', error);
    console.error('Error stack:', (error as Error).stack);
    return false;
  }
}

// Refund credits (add credits back)
export async function refundCredits(amount: number = 1): Promise<boolean> {
  try {
    const currentCredits = await getUserCredits();
    const success = await updateUserCredits(currentCredits + amount);
    return success;
  } catch (error) {
    console.error('Error refunding credits:', error);
    return false;
  }
}

export function getCreditsForProduct(productId: string): number | null {
  const match = creditPackages.find((pkg) => pkg.productId === productId);
  return match ? match.credits : null;
}

export async function grantCreditsForProduct(productId: string): Promise<boolean> {
  const credits = getCreditsForProduct(productId);
  if (credits == null) {
    console.warn('Unknown product ID when granting credits:', productId);
    return false;
  }

  try {
    const currentCredits = await getUserCredits();
    return await updateUserCredits(currentCredits + credits);
  } catch (error) {
    console.error('Error granting credits for product:', error);
    return false;
  }
}
