import { supabase, isRefreshTokenError, handleAuthError, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

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

// Get user's current credits
export async function getUserCredits(): Promise<number> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('Auth error getting user:', userError);
      // If user doesn't exist in JWT, clear the session
      if (isRefreshTokenError(userError) || userError.message?.includes('JWT does not exist')) {
        console.log('Invalid user session detected, clearing...');
        await handleAuthError(userError);
      }
      return 0;
    }
    if (!user) return 0;

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
      console.error('Auth error getting user for credit update:', userError);
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

// Deduct credits for analysis
export async function deductCredits(amount: number = 1): Promise<boolean> {
  try {
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
