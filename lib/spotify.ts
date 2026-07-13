import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

WebBrowser.maybeCompleteAuthSession();

// ---------- Config ----------

const SPOTIFY_CLIENT_ID = '8d66896fc94d4418bd9721687af9421d'; // public id, ok to commit
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_SCOPES = [
  'user-read-email',
  'user-read-private',
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
].join(' ');

const REDIRECT_PATH = 'spotify-auth-callback';
const REFRESH_STALE_AGE_MS = 24 * 60 * 60 * 1000; // 24h

// SecureStore keys (no '@' allowed)
const KEY_REFRESH = 'tunematch_spotify_refresh_token';
const KEY_ACCESS = 'tunematch_spotify_access_token';
const KEY_EXPIRES = 'tunematch_spotify_expires_at';
const KEY_DISPLAY = 'tunematch_spotify_display_name';
const STORAGE_KEY_GUEST_TASTE = '@tunematch/guest_spotify_taste_profile';

// ---------- Types ----------

export type SpotifyTasteProfile = {
  top_artists: Array<{ id: string; name: string; genres: string[] }>;
  top_tracks: Array<{ id: string; name: string; artist: string }>;
  recently_played: Array<{ id: string; name: string; artist: string }>;
  saved_tracks: Array<{ id: string; name: string; artist: string }>;
  top_genres: string[];
  refreshed_at: string;
};

export type SpotifyConnectionStatus = {
  connected: boolean;
  displayName?: string | null;
  isGuest: boolean;
};

// ---------- PKCE helpers ----------

function randomCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let v = '';
  for (let i = 0; i < 96; i++) {
    v += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return v;
}

async function codeChallenge(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'com.paltech.tunematch',
    path: REDIRECT_PATH,
  });
}

// ---------- Edge function helpers ----------

async function callSpotifyAuth(body: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/spotify-auth`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json?.error || `spotify-auth failed (${resp.status})`);
  }
  return json;
}

async function callSyncProfile(body: Record<string, unknown> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-spotify-profile`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json?.error || `sync-spotify-profile failed (${resp.status})`);
  }
  return json;
}

// ---------- Guest SecureStore helpers ----------

async function saveGuestTokens(tokens: {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  display_name?: string | null;
}) {
  await SecureStore.setItemAsync(KEY_ACCESS, tokens.access_token);
  await SecureStore.setItemAsync(KEY_REFRESH, tokens.refresh_token);
  await SecureStore.setItemAsync(KEY_EXPIRES, tokens.expires_at);
  if (tokens.display_name) {
    await SecureStore.setItemAsync(KEY_DISPLAY, tokens.display_name);
  }
}

async function loadGuestTokens(): Promise<{
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}> {
  const [access, refresh, expires] = await Promise.all([
    SecureStore.getItemAsync(KEY_ACCESS),
    SecureStore.getItemAsync(KEY_REFRESH),
    SecureStore.getItemAsync(KEY_EXPIRES),
  ]);
  return { access_token: access, refresh_token: refresh, expires_at: expires };
}

async function clearGuestTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_EXPIRES).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_DISPLAY).catch(() => {}),
    AsyncStorage.removeItem(STORAGE_KEY_GUEST_TASTE).catch(() => {}),
  ]);
}

async function saveGuestTasteProfile(profile: SpotifyTasteProfile) {
  await AsyncStorage.setItem(STORAGE_KEY_GUEST_TASTE, JSON.stringify(profile));
}

export async function loadGuestTasteProfile(): Promise<SpotifyTasteProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_GUEST_TASTE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---------- Public API ----------

/**
 * Is the current user connected to Spotify?
 * Registered = row in spotify_connections. Guest = refresh token in SecureStore.
 */
export async function getSpotifyConnectionStatus(): Promise<SpotifyConnectionStatus> {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    try {
      const { data, error } = await supabase
        .from('spotify_connections')
        .select('display_name')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (error) {
        console.warn('spotify_connections check error:', error.message);
      }
      return {
        connected: !!data,
        displayName: data?.display_name ?? null,
        isGuest: false,
      };
    } catch (err) {
      console.warn('spotify_connections check exception:', err);
      return { connected: false, isGuest: false };
    }
  }

  // Guest
  const tokens = await loadGuestTokens();
  const name = await SecureStore.getItemAsync(KEY_DISPLAY).catch(() => null);
  return {
    connected: !!tokens.refresh_token,
    displayName: name,
    isGuest: true,
  };
}

/**
 * Launch Spotify OAuth (PKCE). On success persists tokens and syncs taste profile.
 */
export async function connectSpotify(): Promise<{ success: boolean; error?: string }> {
  try {
    const redirectUri = buildRedirectUri();
    const verifier = randomCodeVerifier();
    const challenge = await codeChallenge(verifier);
    const state = randomCodeVerifier().slice(0, 16);

    const authUrl = new URL(SPOTIFY_AUTH_URL);
    authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('show_dialog', 'true');

    console.log('🎵 Opening Spotify OAuth:', redirectUri);
    const result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), redirectUri);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { success: false, error: 'Sign-in was cancelled' };
    }
    if (result.type !== 'success' || !('url' in result) || !result.url) {
      return { success: false, error: 'Spotify sign-in failed' };
    }

    const urlObj = new URL(result.url);
    const returnedState = urlObj.searchParams.get('state');
    if (returnedState !== state) {
      return { success: false, error: 'State mismatch' };
    }
    const code = urlObj.searchParams.get('code');
    const error = urlObj.searchParams.get('error');
    if (error) return { success: false, error: `Spotify error: ${error}` };
    if (!code) return { success: false, error: 'No authorization code from Spotify' };

    const exchange = await callSpotifyAuth({
      action: 'exchange',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    // Guest: persist tokens locally
    if (exchange.stored === 'client') {
      await saveGuestTokens({
        access_token: exchange.access_token,
        refresh_token: exchange.refresh_token,
        expires_at: exchange.expires_at,
        display_name: exchange.display_name,
      });
    }

    // Build taste profile (server-stored for registered, client-stored for guest)
    await syncTasteProfile();

    return { success: true };
  } catch (err: any) {
    console.error('connectSpotify error:', err);
    return { success: false, error: err?.message ?? 'Spotify connect failed' };
  }
}

/**
 * Fetch fresh taste profile from Spotify and persist it.
 * Call after connect, on app foreground (if stale), or from a manual refresh button.
 */
export async function syncTasteProfile(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const body: Record<string, unknown> = {};

    if (!session?.user) {
      // Guest: include tokens
      const tokens = await loadGuestTokens();
      if (!tokens.refresh_token) {
        return { success: false, error: 'Not connected to Spotify' };
      }
      body.access_token = tokens.access_token;
      body.refresh_token = tokens.refresh_token;
      body.expires_at = tokens.expires_at;
    }

    const result = await callSyncProfile(body);

    if (result.stored === 'client' && result.profile) {
      await saveGuestTasteProfile(result.profile as SpotifyTasteProfile);
      // Persist possibly-refreshed tokens
      if (result.tokens) {
        await saveGuestTokens({
          access_token: result.tokens.access_token,
          refresh_token: result.tokens.refresh_token,
          expires_at: result.tokens.expires_at,
        });
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('syncTasteProfile error:', err);
    return { success: false, error: err?.message ?? 'Sync failed' };
  }
}

/**
 * If the stored taste profile is older than 24h, sync in background.
 * Safe to call on app foreground.
 */
export async function maybeAutoRefreshTaste(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    let refreshedAt: string | null = null;

    if (session?.user) {
      const { data } = await supabase
        .from('spotify_taste_profiles')
        .select('refreshed_at')
        .eq('user_id', session.user.id)
        .maybeSingle();
      refreshedAt = data?.refreshed_at ?? null;
    } else {
      const local = await loadGuestTasteProfile();
      refreshedAt = local?.refreshed_at ?? null;
    }

    if (!refreshedAt) {
      // Connected but never synced — try sync.
      const status = await getSpotifyConnectionStatus();
      if (status.connected) await syncTasteProfile();
      return;
    }

    const age = Date.now() - new Date(refreshedAt).getTime();
    if (age > REFRESH_STALE_AGE_MS) {
      console.log('🎵 Taste profile stale, syncing...');
      await syncTasteProfile();
    }
  } catch (err) {
    console.warn('maybeAutoRefreshTaste error:', err);
  }
}

/**
 * Remove all guest-local Spotify state. Registered users are cleaned server-side
 * when the account is deleted (CASCADE on auth.users).
 */
export async function clearGuestSpotifyData(): Promise<void> {
  await clearGuestTokens();
}
