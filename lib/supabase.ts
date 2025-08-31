import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';

const SUPABASE_URL = 'https://mebjzwwtuzwcrwugxjvu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYmp6d3d0dXp3Y3J3dWd4anZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5Mzg2NDAsImV4cCI6MjA2ODUxNDY0MH0.x7GFKp-YC89d1Y-p9VNzDwfyOuWR34xd9b_t4ylFn6g';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Utility function to check if an error is a refresh token error
export function isRefreshTokenError(error: any): boolean {
  if (!error) return false;
  const message = error.message || '';
  return (
    message.includes('refresh_token_not_found') ||
    message.includes('Invalid Refresh Token') ||
    message.includes('Refresh Token Not Found') ||
    error.status === 401
  );
}

// Function to handle authentication errors gracefully
export async function handleAuthError(error: any): Promise<void> {
  if (isRefreshTokenError(error)) {
    console.log('Refresh token error detected, signing out user');
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.error('Error during forced signout:', signOutError);
      // Clear storage manually if signOut fails
      AsyncStorage.removeItem('supabase.auth.token');
    }
  }
}

// Global error handler for authentication errors
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' && !session) {
    // Clear any stored session data when signed out
    AsyncStorage.removeItem('supabase.auth.token');
  }
});

// Apple Sign-In
export async function signInWithApple(): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if Apple Authentication is available
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: 'Apple Sign-In is not available on this device' };
    }

    // Request Apple Authentication
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    console.log('Apple credential received:', {
      user: credential.user,
      email: credential.email,
      fullName: credential.fullName,
    });

    // Sign in with Supabase using Apple ID token
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken!,
    });

    if (error) {
      console.error('Supabase Apple sign-in error:', error);
      return { success: false, error: error.message };
    }

    console.log('Apple sign-in successful:', data.user?.email);
    return { success: true };
  } catch (error: any) {
    console.error('Apple sign-in error:', error);
    if (error.code === 'ERR_REQUEST_CANCELED') {
      return { success: false, error: 'Sign-in was cancelled' };
    }
    return { success: false, error: 'Apple sign-in failed. Please try again.' };
  }
}

// Configure WebBrowser for auth sessions
WebBrowser.maybeCompleteAuthSession();

// Google OAuth Configuration
const GOOGLE_CLIENT_ID = '644413142655-0shj7hlrh1ms5j1e9hi6k1s6evdqo1c8.apps.googleusercontent.com';

// Google Sign-In using expo-auth-session
export async function signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
  try {
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'com.paltech.tunematch'
    });

    console.log('Redirect URI:', redirectUri);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUri,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      console.error('Supabase Google OAuth error:', error);
      return { success: false, error: error.message };
    }

    if (!data.url) {
      return { success: false, error: 'Failed to get authorization URL' };
    }

    // Open the OAuth URL in the browser
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

    if (result.type === 'success' && result.url) {
      // Parse the callback URL to get the authorization code or token
      const url = new URL(result.url);
      const fragments = url.hash.substring(1);
      const params = new URLSearchParams(fragments);
      
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      
      if (accessToken) {
        // Set the session in Supabase
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || '',
        });

        if (sessionError) {
          console.error('Error setting session:', sessionError);
          return { success: false, error: sessionError.message };
        }

        console.log('Google sign-in successful');
        return { success: true };
      }
    }

    if (result.type === 'cancel') {
      return { success: false, error: 'Sign-in was cancelled' };
    }

    return { success: false, error: 'Google sign-in failed. Please try again.' };
  } catch (error: any) {
    console.error('Google sign-in error:', error);
    return { success: false, error: 'Google sign-in failed. Please try again.' };
  }
}

// Sign out from Google (handled by Supabase)
export async function signOutFromGoogle(): Promise<void> {
  // No additional action needed as Supabase handles the OAuth session
  console.log('Google sign-out handled by Supabase');
}

// Function to get a fresh signed URL for an image
export async function getImageSignedUrl(filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('images')
      .createSignedUrl(filePath, 60 * 60); // 1 hour expiration

    if (error) {
      console.error('Error creating signed URL:', error);
      return null;
    }

    return data.signedUrl;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return null;
  }
}
