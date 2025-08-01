import { supabase } from './supabase';
import * as InAppPurchases from 'expo-in-app-purchases';

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

// Free trial constants
export const FREE_CREDITS_ON_SIGNUP = 3;
export const FIRST_ANALYSIS_FREE = true;

// Get user's current credits
export async function getUserCredits(): Promise<number> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching credits:', error);
      return 0;
    }

    return data?.credits || FREE_CREDITS_ON_SIGNUP; // Default to free credits for new users
  } catch (error) {
    console.error('Error getting user credits:', error);
    return FREE_CREDITS_ON_SIGNUP;
  }
}

// Update user's credits
export async function updateUserCredits(newCredits: number): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.rpc('update_user_credits', {
      user_id: user.id,
      new_credits: newCredits
    });

    if (error) {
      console.error('Error updating credits:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating user credits:', error);
    return false;
  }
}

// Deduct credits for analysis
export async function deductCredits(amount: number = 1): Promise<boolean> {
  try {
    const currentCredits = await getUserCredits();
    if (currentCredits < amount) {
      return false; // Not enough credits
    }

    const success = await updateUserCredits(currentCredits - amount);
    return success;
  } catch (error) {
    console.error('Error deducting credits:', error);
    return false;
  }
}

// Purchase credits
export async function purchaseCredits(packageId: string): Promise<boolean> {
  try {
    const package_ = creditPackages.find(p => p.id === packageId);
    if (!package_) return false;

    // Initialize in-app purchases
    await InAppPurchases.connectAsync();

    // Purchase the product
    const { responseCode, results } = await InAppPurchases.purchaseItemAsync(package_.productId);

    if (responseCode === InAppPurchases.IAPResponseCode.OK) {
      // Purchase successful, add credits
      const currentCredits = await getUserCredits();
      const success = await updateUserCredits(currentCredits + package_.credits);
      
      // Finish the transaction
      await InAppPurchases.finishTransactionAsync(results[0], true);
      
      return success;
    }

    return false;
  } catch (error) {
    console.error('Error purchasing credits:', error);
    return false;
  }
} 