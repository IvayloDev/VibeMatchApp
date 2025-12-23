import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { Alert } from 'react-native';
import { supabase, isRefreshTokenError, signOutFromGoogle } from './supabase';
import { mergeLocalCreditsToAccount } from './credits';

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
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

  const clearSession = () => {
    setSession(null);
    setUser(null);
    setLoading(false);
  };

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
        } else if (event === 'SIGNED_IN' && session?.user) {
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
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      // Sign out from Google if user was signed in with Google
      await signOutFromGoogle();
      
      // Sign out from Supabase
      await supabase.auth.signOut();
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
    signOut,
    clearSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 