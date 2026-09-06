import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { registerSuperProperties } from './posthog';
// Same AsyncStorage key as the Spotify sync on purpose: loadGuestTasteProfile()
// and AnalyzingScreen read a picked profile from there exactly as they would a
// Spotify-derived one. Whichever wrote last wins.
import { STORAGE_KEY_GUEST_TASTE } from './spotify';
import type { SpotifyTasteProfile } from './spotify';

/**
 * In-app taste picker.
 *
 * The product promised matches tuned to the user's music taste, sourced from
 * Spotify listening data. The Spotify developer app is in Development mode
 * (a 5-account allowlist), so that data never loads for the public. Taste now
 * comes from a picker: up to 3 artists searched against Spotify's catalog
 * (app credentials, which Development mode allows) and up to 3 genres.
 *
 * The result is saved in the SAME shape and place as the Spotify-derived
 * profile - the guest AsyncStorage cache, and spotify_taste_profiles for
 * registered users - so the onboarding reveal pages, AnalyzingScreen and the
 * recommend-songs function work on it unchanged. The only additions are a
 * `source` marker and the genres the user picked by hand.
 */

export const MAX_TASTE_ARTISTS = 3;
export const MAX_TASTE_GENRES = 3;
// Same cap as deriveTopGenres in sync-spotify-profile.
const MAX_TOP_GENRES = 15;
const MAX_GENRES_PER_ARTIST = 5;
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Curated genres a listener recognises at a glance. Lower case to match the
 * strings Spotify tags artists with, so picked and derived genres look alike.
 */
export const GENRE_OPTIONS: readonly string[] = [
  'pop',
  'hip hop',
  'r&b',
  'rock',
  'indie',
  'electronic',
  'house',
  'techno',
  'latin',
  'reggaeton',
  'afrobeats',
  'k-pop',
  'jazz',
  'soul',
  'funk',
  'country',
  'folk',
  'classical',
  'lo-fi',
  'ambient',
  'metal',
  'punk',
  'reggae',
  'dancehall',
];

/** One artist as returned by spotify-search; same shape as a top_artists entry. */
export type TasteArtist = {
  id: string;
  name: string;
  genres: string[];
  image: string | null;
};

export type TasteSource = 'manual' | 'spotify' | 'none';

/**
 * A stored taste profile plus where it came from. Spotify-derived profiles
 * predate `source`, so a profile without the field is a Spotify one.
 */
export type TasteProfileWithSource = SpotifyTasteProfile & {
  source?: 'manual' | 'spotify';
  picked_genres?: string[];
};

export type ManualTasteProfile = SpotifyTasteProfile & {
  source: 'manual';
  // The genres chosen by hand, separate from those inherited from the picked
  // artists, so the picker can restore the exact selection later.
  picked_genres: string[];
};

export type ManualTasteInput = {
  artists: TasteArtist[];
  genres: string[];
};

/**
 * Thrown by saveManualTasteProfile. `stage` says how far the save got: a
 * 'server' failure means the local copy is already written and only the
 * account sync failed, which callers can offer to retry.
 */
export class TasteSaveError extends Error {
  stage: 'local' | 'server';

  constructor(stage: 'local' | 'server', message: string) {
    super(message);
    this.name = 'TasteSaveError';
    this.stage = stage;
  }
}

export function getTasteSource(
  profile: { source?: string } | null | undefined
): TasteSource {
  if (!profile) return 'none';
  return profile.source === 'manual' ? 'manual' : 'spotify';
}

function normalizeGenre(genre: unknown): string {
  return typeof genre === 'string' ? genre.trim().toLowerCase() : '';
}

function uniqueGenres(genres: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of genres) {
    const genre = normalizeGenre(raw);
    if (!genre || seen.has(genre)) continue;
    seen.add(genre);
    out.push(genre);
  }
  return out;
}

function normalizeArtist(raw: any): TasteArtist {
  return {
    id: typeof raw?.id === 'string' ? raw.id : '',
    name: typeof raw?.name === 'string' ? raw.name : '',
    genres: Array.isArray(raw?.genres)
      ? uniqueGenres(raw.genres).slice(0, MAX_GENRES_PER_ARTIST)
      : [],
    image: typeof raw?.image === 'string' && raw.image ? raw.image : null,
  };
}

/**
 * Search Spotify's artist catalog through the spotify-search edge function.
 * Resolves to an empty list for a blank query; rejects on transport or server
 * errors (and with an AbortError when `signal` fires) so the caller can show
 * an inline message instead of an empty result.
 */
export async function searchArtists(
  q: string,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<TasteArtist[]> {
  const query = q.trim();
  if (!query) return [];

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/spotify-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ q: query, limit: options.limit ?? DEFAULT_SEARCH_LIMIT }),
    signal: options.signal,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json?.error || `spotify-search failed (${resp.status})`);
  }
  const artists: unknown[] = Array.isArray(json?.artists) ? json.artists : [];
  return artists.map(normalizeArtist).filter((a) => a.id && a.name);
}

/**
 * Build the profile object without persisting it. `top_genres` leads with the
 * hand-picked genres, then those of the picked artists, deduplicated.
 */
export function buildManualTasteProfile({ artists, genres }: ManualTasteInput): ManualTasteProfile {
  const topArtists = artists.slice(0, MAX_TASTE_ARTISTS).map((a) => ({
    id: a.id,
    name: a.name,
    genres: uniqueGenres(a.genres ?? []).slice(0, MAX_GENRES_PER_ARTIST),
    image: a.image ?? null,
  }));
  const pickedGenres = uniqueGenres(genres).slice(0, MAX_TASTE_GENRES);
  const artistGenres = topArtists.flatMap((a) => a.genres);

  return {
    top_artists: topArtists,
    top_tracks: [],
    recently_played: [],
    saved_tracks: [],
    top_genres: uniqueGenres([...pickedGenres, ...artistGenres]).slice(0, MAX_TOP_GENRES),
    refreshed_at: new Date().toISOString(),
    source: 'manual',
    picked_genres: pickedGenres,
  };
}

async function callSaveTasteProfile(profile: ManualTasteProfile, accessToken: string): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/save-taste-profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ profile }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json?.error || `save-taste-profile failed (${resp.status})`);
  }
}

/**
 * Persist a picked taste profile.
 *
 * Always written to the guest AsyncStorage cache: that is what AnalyzingScreen
 * sends inline for guests, and it lets the picker restore the selection later.
 * With a Supabase session it is also written to spotify_taste_profiles through
 * save-taste-profile, which is where recommend-songs looks for registered
 * users. Rejects with a TasteSaveError; see its `stage`.
 */
export async function saveManualTasteProfile(
  input: ManualTasteInput
): Promise<{ profile: ManualTasteProfile; storedOnServer: boolean }> {
  const profile = buildManualTasteProfile(input);
  if (profile.top_artists.length === 0 && profile.top_genres.length === 0) {
    throw new TasteSaveError('local', 'Pick at least one artist or genre');
  }

  try {
    await AsyncStorage.setItem(STORAGE_KEY_GUEST_TASTE, JSON.stringify(profile));
  } catch (err: any) {
    throw new TasteSaveError('local', err?.message ?? 'Could not save your taste on this device');
  }

  // Past this point the device copy is written, so any failure is a server
  // (account sync) failure, including one from resolving the session.
  let storedOnServer = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      await callSaveTasteProfile(profile, session.access_token);
      storedOnServer = true;
    }
  } catch (err: any) {
    throw new TasteSaveError('server', err?.message ?? 'Could not sync your taste to your account');
  }

  // Super property so every later event (scan_started, purchase_completed...)
  // can be split by where the taste came from, without plumbing it through.
  registerSuperProperties({ taste_source: 'manual', has_taste: true });

  return { profile, storedOnServer };
}

/**
 * The picked profile cached on this device, or null when the cache is empty or
 * holds a Spotify-derived profile.
 */
export async function loadManualTasteProfile(): Promise<ManualTasteProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_GUEST_TASTE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.source === 'manual' ? (parsed as ManualTasteProfile) : null;
  } catch {
    return null;
  }
}
