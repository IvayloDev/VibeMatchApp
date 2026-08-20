import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase, isRefreshTokenError, signOutFromGoogle } from './supabase';
import { mergeLocalCreditsToAccount } from './credits';
import { grantRegisteredFreeCredits } from './utils/freeCredits';
import {
  getSpotifyConnectionStatus,
  maybeAutoRefreshTaste,
  clearGuestSpotifyData,
} from './spotify';

const ONBOARDING_KEY = 'tunematch_onboarding_complete';
// Guests have no Supabase user, so `onboardingComplete` (which is scoped to a
// registered session on purpose) cannot answer "has this device already been
// through onboarding?". Without a device-scoped flag every cold start sent a
// guest back to Welcome -> Onboarding, forcing them to re-onboard forever.
const GUEST_ONBOARDING_KEY = 'tunematch_guest_onboarding_complete';
export const HAD_ACCOUNT_KEY = 'tunematch_had_account';

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  spotifyConnected: boolean;
  spotifyChecking: boolean;
  onboardingComplete: boolean;
  guestOnboardingComplete: boolean;
  onboardingChecking: boolean;
  refreshSpotifyStatus: (options?: { silent?: boolean }) => Promise<void>;
  markOnboardingComplete: () => Promise<void>;
  markGuestOnboardingComplete: () => Promise<void>;
  signOut: () => Promise<void>;
  clearSession: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

type AuthProviderProps = {
  children: React.ReactNode;
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyChecking, setSpotifyChecking] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [guestOnboardingComplete, setGuestOnboardingComplete] = useState(false);
  const [onboardingChecking, setOnboardingChecking] = useState(true);

  const clearSession = () => {
    setSession(null);
    setUser(null);
    setSpotifyConnected(false);
    setLoading(false);
  };

  const markOnboardingComplete = async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, 'true');
    setOnboardingComplete(true);
  };

  const markGuestOnboardingComplete = async () => {
    await SecureStore.setItemAsync(GUEST_ONBOARDING_KEY, 'true');
    setGuestOnboardingComplete(true);
  };

  /**
   * Re-read the Spotify connection.
   *
   * `spotifyChecking` is not a harmless loading flag: App.js renders
   * LoadingScreen while it is true, which UNMOUNTS the NavigationContainer and
   * remounts it at getTarget() - throwing away the current screen and landing
   * on the initial tab. So any caller that is not doing first-run routing must
   * pass { silent: true }, which updates `spotifyConnected` without touching
   * `spotifyChecking` and therefore without disturbing navigation.
   */
  // True once the Spotify connection has been resolved at least once.
  const hasResolvedSpotifyOnce = useRef(false);

  const refreshSpotifyStatus = useCallback(async (options?: { silent?: boolean }) => {
    // `spotifyChecking` gates the FIRST resolution only. After boot it must
    // never go true again: App.js renders LoadingScreen while it is set, which
    // unmounts the NavigationContainer and remounts it at the initial route.
    //
    // A silent flag alone was not enough. getSpotifyConnectionStatus() calls
    // supabase.auth.getSession(), which can emit an auth event, and the
    // onAuthStateChange handler below then calls this function again - so a
    // silent caller could still trigger a non-silent refresh indirectly and
    // throw the user off whatever screen they were on. Latching the flag closes
    // that loop for every caller, present and future.
    const silent = options?.silent === true || hasResolvedSpotifyOnce.current;
    if (!silent) setSpotifyChecking(true);
    try {
      const status = await getSpotifyConnectionStatus();
      setSpotifyConnected(status.connected);
      if (status.connected) {
        // Fire-and-forget; don't block UI
        maybeAutoRefreshTaste().catch(() => {});
      }
    } catch (err) {
      console.warn('Spotify status check failed:', err);
      setSpotifyConnected(false);
    } finally {
      hasResolvedSpotifyOnce.current = true;
      if (!silent) setSpotifyChecking(false);
    }
  }, []);

  // Load onboarding state from SecureStore (fast, runs independently).
  // Both flags must resolve before onboardingChecking flips, because App.js
  // computes its initial route from them the moment the loading screen clears.
  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync(ONBOARDING_KEY).catch(() => null),
      SecureStore.getItemAsync(GUEST_ONBOARDING_KEY).catch(() => null),
    ])
      .then(([registered, guest]) => {
        setOnboardingComplete(registered === 'true');
        setGuestOnboardingComplete(guest === 'true');
      })
      .catch(() => {
        setOnboardingComplete(false);
        setGuestOnboardingComplete(false);
      })
      .finally(() => setOnboardingChecking(false));
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Error getting session:', error);
        // If we get an auth error during initial session retrieval, clear the session
        if (isRefreshTokenError(error) || error.message?.includes('JWT does not exist')) {
          console.log('Invalid session detected, clearing...');
          clearSession();
          // Sign out to clear stale tokens
          supabase.auth.signOut().catch(() => {});
          return;
        }
      }
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      refreshSpotifyStatus();
    }).catch((error) => {
      console.error('Unexpected error during session retrieval:', error);
      if (isRefreshTokenError(error) || error.message?.includes('JWT does not exist')) {
        clearSession();
        supabase.auth.signOut().catch(() => {});
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session ? 'session exists' : 'no session');
        
        // Handle specific auth events
        if (event === 'TOKEN_REFRESHED') {
          console.log('Token refreshed successfully');
        } else if (event === 'SIGNED_OUT') {
          console.log('User signed out');
          // Re-read onboarding flag from SecureStore — it may have been deleted
          // (e.g. during account deletion) while the in-memory state was still true
          SecureStore.getItemAsync(ONBOARDING_KEY)
            .then(val => setOnboardingComplete(val === 'true'))
            .catch(() => setOnboardingComplete(false));
        } else if (event === 'SIGNED_IN' && session?.user) {
          // Mark that a real account has existed on this device
          SecureStore.setItemAsync(HAD_ACCOUNT_KEY, 'true').catch(() => {});
          const userId = session.user.id;

          // Grant free credits to new registered users (one-time only).
          // Check three guards in order:
          //   1. user_metadata flag (fast, survives reinstalls on same account)
          //   2. credited_emails table (survives account deletion + re-signup with same email)
          //   3. local SecureStore key (per userId, last-resort local check)
          const alreadyGrantedServerSide = session.user.user_metadata?.free_credits_granted === true;
          if (!alreadyGrantedServerSide) {
            try {
              // Check if this email has ever received free credits
              let alreadyGrantedByEmail = false;
              if (session.user.email) {
                const { data: creditedRow } = await supabase
                  .from('credited_emails')
                  .select('email')
                  .eq('email', session.user.email)
                  .maybeSingle();
                alreadyGrantedByEmail = !!creditedRow;
              }

              if (alreadyGrantedByEmail) {
                console.log('⚠️ Email already credited — skipping free credits');
                // Stamp metadata so we skip this check next login
                await supabase.auth.updateUser({ data: { free_credits_granted: true } });
              } else {
                const creditsGranted = await grantRegisteredFreeCredits(userId);
                if (creditsGranted) {
                  // Persist flag to auth.users metadata so it survives reinstalls
                  await supabase.auth.updateUser({ data: { free_credits_granted: true } });
                  // Also record email so deletion + re-signup can't claim again
                  if (session.user.email) {
                    await supabase.from('credited_emails').upsert(
                      { email: session.user.email },
                      { onConflict: 'email' }
                    );
                  }
                  console.log('✅ Registered free credits granted to new user');
                }
              }
            } catch (error) {
              console.error('Error granting registered free credits:', error);
            }
          }
          
          // Apple Guideline 5.1.1: Merge local credits when user signs in
          // This enables cross-device access for credits purchased without registration
          console.log('User signed in, checking for local credits to merge...');
          try {
            const { merged, creditsMerged } = await mergeLocalCreditsToAccount();
            if (merged && creditsMerged > 0) {
              console.log(`✅ Merged ${creditsMerged} local credits to account`);
              // Notify user that their credits have been synced
              Alert.alert(
                '✨ Credits Synced!',
                `Your ${creditsMerged} credits have been added to your account. You can now access them from any device!`,
                [{ text: 'Great!' }]
              );
            }
          } catch (error) {
            console.error('Error merging local credits:', error);
          }
        }
        
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        // Silent: by this point the app has booted, and re-gating would tear
        // down navigation under whatever screen the user is on.
        refreshSpotifyStatus({ silent: true });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      // Sign out from Google if user was signed in with Google
      await signOutFromGoogle();

      // Clear any guest Spotify state as well
      await clearGuestSpotifyData();

      // Sign out from Supabase
      await supabase.auth.signOut();
      setSpotifyConnected(false);
    } catch (error) {
      console.error('Error signing out:', error);
      // Even if signOut fails, clear the local session
      clearSession();
    }
  };

  const value = {
    user,
    session,
    loading,
    spotifyConnected,
    spotifyChecking,
    onboardingComplete,
    guestOnboardingComplete,
    onboardingChecking,
    refreshSpotifyStatus,
    markOnboardingComplete,
    markGuestOnboardingComplete,
    signOut,
    clearSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 