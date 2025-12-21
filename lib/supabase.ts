import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';

export const SUPABASE_URL = 'https://mebjzwwtuzwcrwugxjvu.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYmp6d3d0dXp3Y3J3dWd4anZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5Mzg2NDAsImV4cCI6MjA2ODUxNDY0MH0.x7GFKp-YC89d1Y-p9VNzDwfyOuWR34xd9b_t4ylFn6g';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // Enable to detect OAuth redirects
  },
});

// Utility function to check if an error is a refresh token error or invalid user error
export function isRefreshTokenError(error: any): boolean {
  if (!error) return false;
  const message = error.message || '';
  return (
    message.includes('refresh_token_not_found') ||
    message.includes('Invalid Refresh Token') ||
    message.includes('Refresh Token Not Found') ||
    message.includes('User from sub claim in JWT does not exist') ||
    message.includes('JWT does not exist') ||
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
    // For native iOS apps, the bundle identifier (com.paltech.tunematch) 
    // is automatically included in the token's audience claim
    // Make sure this matches what's configured in Supabase Dashboard
    if (!credential.identityToken) {
      return { success: false, error: 'No identity token received from Apple' };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
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

// Helper function to convert hex string to base64url (React Native compatible)
function hexToBase64Url(hex: string): string {
  // Convert hex to bytes
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  
  // Convert bytes to base64
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  let i = 0;
  
  while (i < bytes.length) {
    const a = bytes[i++];
    const b = i < bytes.length ? bytes[i++] : 0;
    const c = i < bytes.length ? bytes[i++] : 0;
    
    const bitmap = (a << 16) | (b << 8) | c;
    
    base64 += chars.charAt((bitmap >> 18) & 63);
    base64 += chars.charAt((bitmap >> 12) & 63);
    base64 += i - 2 < bytes.length ? chars.charAt((bitmap >> 6) & 63) : '=';
    base64 += i - 1 < bytes.length ? chars.charAt(bitmap & 63) : '=';
  }
  
  // Convert to base64url (replace +/= with -_ and remove padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Helper function to generate random base64url string for PKCE code verifier
// PKCE spec requires: 43-128 characters, URL-safe base64
async function generateRandomBase64Url(length: number): Promise<string> {
  // Generate enough random data to create a proper base64url string
  const randomData = Array.from({ length: 96 }, () => 
    Math.floor(Math.random() * 256)
  );
  
  // Convert to base64 manually (URL-safe)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  
  for (let i = 0; i < randomData.length; i += 3) {
    const a = randomData[i];
    const b = randomData[i + 1] || 0;
    const c = randomData[i + 2] || 0;
    
    const bitmap = (a << 16) | (b << 8) | c;
    
    result += chars.charAt((bitmap >> 18) & 63);
    result += chars.charAt((bitmap >> 12) & 63);
    if (i + 1 < randomData.length) {
      result += chars.charAt((bitmap >> 6) & 63);
    }
    if (i + 2 < randomData.length) {
      result += chars.charAt(bitmap & 63);
    }
  }
  
  // Return the requested length (43-128 for PKCE)
  return result.substring(0, Math.min(Math.max(length, 43), 128));
}

// Google OAuth Configuration - iOS Client ID from Google Cloud Console
const GOOGLE_IOS_CLIENT_ID = '1010555883524-4pvh5f2rvsq3t3s92rriajei3a313jvu.apps.googleusercontent.com';

// Google OAuth endpoints
const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

// Google Sign-In using authorization code flow with PKCE (required for iOS clients)
// iOS clients don't support implicit flow (id_token), so we use code exchange
export async function signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
  try {
    // Use the app scheme as redirect URI (iOS clients allow custom schemes)
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'com.paltech.tunematch',
    });
    
    console.log('Google OAuth redirect URI:', redirectUri);
    
    // Generate PKCE code verifier and challenge
    // Code verifier: random 43-128 character URL-safe string
    // Use only unreserved characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
    const codeVerifierChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let codeVerifier = '';
    for (let i = 0; i < 64; i++) {
      codeVerifier += codeVerifierChars.charAt(Math.floor(Math.random() * codeVerifierChars.length));
    }
    console.log('Code verifier generated, length:', codeVerifier.length);
    
    // Code challenge: BASE64URL(SHA256(code_verifier))
    // Use base64 encoding directly from expo-crypto
    const codeChallengeBase64 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      codeVerifier,
      { encoding: Crypto.CryptoEncoding.BASE64 }
    );
    
    // Convert base64 to base64url (replace +/ with -_, remove padding)
    const codeChallenge = codeChallengeBase64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    console.log('Code challenge generated, length:', codeChallenge.length);
    
    // Build the authorization URL for Google OAuth (authorization code flow)
    const authUrl = new URL(discovery.authorizationEndpoint);
    authUrl.searchParams.set('client_id', GOOGLE_IOS_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code'); // Use code flow, not id_token
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    console.log('Opening Google OAuth URL...');
    console.log('Auth URL:', authUrl.toString());
    
    // Open the auth session - this handles the redirect back to the app
    const result = await WebBrowser.openAuthSessionAsync(
      authUrl.toString(),
      redirectUri
    );
    
    console.log('OAuth result type:', result.type);
    
    if (result.type === 'cancel') {
      return { success: false, error: 'Sign-in was cancelled' };
    }
    
    if (result.type !== 'success' || !('url' in result) || !result.url) {
      console.log('OAuth result:', result);
      return { success: false, error: 'Google sign-in failed. Please try again.' };
    }
    
    console.log('OAuth callback URL:', result.url);
    
    // Extract the authorization code from the URL
    const urlObj = new URL(result.url);
    const code = urlObj.searchParams.get('code');
    const error = urlObj.searchParams.get('error');
    
    if (error) {
      console.error('Google OAuth error:', error);
      const errorDescription = urlObj.searchParams.get('error_description') || error;
      return { success: false, error: `Google authentication error: ${errorDescription}` };
    }
    
    if (!code) {
      console.error('No authorization code in response');
      console.error('Full URL:', result.url);
      return { success: false, error: 'No authorization code received from Google' };
    }
    
    console.log('Got authorization code, exchanging for tokens...');
    
    // Exchange authorization code for tokens
    // Manually construct form data (URLSearchParams doesn't work reliably in React Native)
    const formData = [
      `client_id=${encodeURIComponent(GOOGLE_IOS_CLIENT_ID)}`,
      `code=${encodeURIComponent(code)}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `grant_type=${encodeURIComponent('authorization_code')}`,
      `code_verifier=${encodeURIComponent(codeVerifier)}`,
    ].join('&');
    
    console.log('Token exchange request body:', formData.replace(/code_verifier=[^&]+/, 'code_verifier=***'));
    
    const tokenResponse = await fetch(discovery.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange error:', errorText);
      return { success: false, error: 'Failed to exchange authorization code for tokens' };
    }
    
    const tokenData = await tokenResponse.json();
    const idToken = tokenData.id_token;
    
    if (!idToken) {
      console.error('No ID token in token response:', tokenData);
      return { success: false, error: 'No ID token received from Google' };
    }
    
    console.log('Got Google ID token, signing in with Supabase...');
    
    // Sign in with Supabase using the Google ID token (same as Apple Sign-In)
    const { data, error: supabaseError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    
    if (supabaseError) {
      console.error('Supabase Google sign-in error:', supabaseError);
      return { success: false, error: supabaseError.message };
    }
    
    console.log('✅ Google sign-in successful:', data.user?.email);
    return { success: true };
    
  } catch (error: any) {
    console.error('Google sign-in error:', error);
    if (error.code === 'ERR_REQUEST_CANCELED') {
      return { success: false, error: 'Sign-in was cancelled' };
    }
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
    // Check if user is authenticated
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('⚠️ No session when creating signed URL');
      return null;
    }

    // Validate file path
    if (!filePath || filePath.trim().length === 0) {
      console.warn('⚠️ Invalid file path for signed URL');
      return null;
    }

    const { data, error } = await supabase.storage
      .from('images')
      .createSignedUrl(filePath, 60 * 60); // 1 hour expiration

    if (error) {
      console.error('Error creating signed URL:', error);
      console.error('File path:', filePath);
      console.error('Error details:', {
        message: error.message,
        statusCode: (error as any).statusCode,
        error: (error as any).error
      });
      return null;
    }

    if (!data || !data.signedUrl) {
      console.warn('⚠️ No signed URL returned from storage');
      return null;
    }

    return data.signedUrl;
  } catch (error: any) {
    console.error('Error getting signed URL:', error);
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error?.message);
    // If it's a JSON parse error, it means the API returned HTML (likely an error page)
    if (error?.message?.includes('JSON Parse error') || error?.message?.includes('Unexpected character')) {
      console.error('⚠️ Storage API returned HTML instead of JSON - likely authentication or permissions issue');
    }
    return null;
  }
}

/**
 * Validate a purchase with the server
 * Calls the validate-purchase edge function
 */
export async function validatePurchase(
  transactionId: string,
  productId: string
): Promise<{
  success: boolean;
  creditsGranted?: number;
  newBalance?: number;
  error?: string;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const { data, error } = await supabase.functions.invoke('validate-purchase', {
      body: {
        transactionId,
        productId,
        platform: 'ios',
      },
    });

    if (error) {
      console.error('Error validating purchase:', error);
      // Supabase functions.invoke returns error for non-2xx responses
      // The error might contain the response body
      let errorMessage = 'Validation failed';
      
      // Try to extract error from different possible locations
      if (error.message) {
        errorMessage = error.message;
      } else if ((error as any).context?.message) {
        errorMessage = (error as any).context.message;
      } else if ((error as any).message) {
        errorMessage = (error as any).message;
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }

    // Handle response data
    if (!data) {
      return { success: false, error: 'No response from server' };
    }

    // If response has error field, it's an error response
    if (typeof data === 'object' && 'error' in data && !('success' in data)) {
      return {
        success: false,
        error: (data as any).error || 'Validation failed',
      };
    }

    // If response has success field, return it
    if (typeof data === 'object' && 'success' in data) {
      return data as any;
    }

    // Unknown response format
    return { success: false, error: 'Unexpected response format' };
  } catch (error: any) {
    console.error('Error calling validate-purchase:', error);
    return {
      success: false,
      error: error.message || 'Network error',
    };
  }
}
