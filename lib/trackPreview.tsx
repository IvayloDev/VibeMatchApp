// In-app 30-second preview player.
// One shared audio player, only one track at a time. Resolves a preview URL from
// the Spotify preview_url when present, else the iTunes Search API (free, no auth).
// If neither exists, gracefully opens the full track in Spotify.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

type PreviewSong = {
  title: string;
  artist: string;
  preview_url?: string | null;
  spotify_url?: string;
};

type Status = 'idle' | 'loading' | 'playing';
type Availability = 'unknown' | 'available' | 'unavailable';

type TrackPreviewCtx = {
  activeKey: string | null;
  status: Status;
  progress: number; // 0..1 for the active track
  availability: Record<string, Availability>;
  checkAvailability: (key: string, song: PreviewSong) => void;
  toggle: (key: string, song: PreviewSong) => void;
  stop: () => void;
};

const Ctx = createContext<TrackPreviewCtx | null>(null);

/** Normalize for comparison: lowercase, strip "(feat…)"/"- Live" decorations. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    .replace(/\s+-\s+(feat\.?|ft\.?|with|live|remaster(ed)?|deluxe|radio edit|single version).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function artistMatches(candidate: string, want: string): boolean {
  const a = norm(candidate);
  return a === want || a.includes(want) || want.includes(a);
}

/** Deezer: free, no auth, and currently the best preview coverage. */
async function deezerPreview(song: PreviewSong): Promise<string | null> {
  try {
    const q = encodeURIComponent(`${song.artist} ${song.title}`.trim());
    const r = await fetch(`https://api.deezer.com/search?q=${q}&limit=10`);
    if (!r.ok) return null;
    const j = await r.json();
    const wantTitle = norm(song.title);
    const wantArtist = norm(song.artist);
    const hit = (j?.data || []).find(
      (res: any) =>
        res?.preview &&
        norm(res.title) === wantTitle &&
        artistMatches(res?.artist?.name ?? '', wantArtist)
    );
    return hit?.preview ?? null;
  } catch {
    return null;
  }
}

async function itunesPreview(song: PreviewSong): Promise<string | null> {
  try {
    const term = encodeURIComponent(`${song.artist} ${song.title}`.trim());
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10`);
    if (!r.ok) return null;
    const j = await r.json();
    const wantTitle = norm(song.title);
    const wantArtist = norm(song.artist);
    const hit = (j?.results || []).find(
      (res: any) =>
        res?.previewUrl &&
        norm(res.trackName) === wantTitle &&
        artistMatches(res?.artistName ?? '', wantArtist)
    );
    return hit?.previewUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a 30s preview URL, or null when the track genuinely can't be previewed.
 *
 * Spotify has effectively stopped returning preview_url for API apps (it is null
 * for virtually every track now), so the third-party sources do the real work.
 * Titles must match EXACTLY once normalized — a substring test is not enough,
 * since "cherry blossom".includes("cherry") is true, which is how a completely
 * different song got played. Returning null is correct and expected; the caller
 * hides the play button rather than opening Spotify.
 */
async function resolvePreviewUrl(song: PreviewSong): Promise<string | null> {
  if (song.preview_url) return song.preview_url;
  return (await deezerPreview(song)) ?? (await itunesPreview(song));
}

export function TrackPreviewProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const reqIdRef = useRef(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  // Preview availability per track, resolved once and cached so the button can
  // hide itself when a track can't be previewed (instead of opening Spotify).
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const urlCacheRef = useRef<Record<string, string | null>>({});
  const inFlightRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    // Play even when the phone's silent switch is on (expected for a tap-to-play).
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      try { playerRef.current?.remove(); } catch { /* noop */ }
      playerRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    reqIdRef.current++; // cancel any in-flight resolve
    try { playerRef.current?.pause(); } catch { /* noop */ }
    setActiveKey(null);
    setStatus('idle');
    setProgress(0);
  }, []);

  // Navigation keeps screens mounted, so unmount cleanup alone let audio keep
  // playing after leaving the screen. Stop on blur.
  useFocusEffect(
    useCallback(() => {
      return () => stop();
    }, [stop])
  );

  /** Resolve (once) whether a track can be previewed; cached for instant playback. */
  const checkAvailability = useCallback(async (key: string, song: PreviewSong) => {
    if (key in urlCacheRef.current || inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;
    const url = await resolvePreviewUrl(song);
    urlCacheRef.current[key] = url;
    inFlightRef.current[key] = false;
    setAvailability((prev) => ({ ...prev, [key]: url ? 'available' : 'unavailable' }));
  }, []);

  const toggle = useCallback(async (key: string, song: PreviewSong) => {
    // Tapping the track that's already playing pauses it.
    if (activeKey === key && status === 'playing') {
      stop();
      return;
    }

    const reqId = ++reqIdRef.current;
    setActiveKey(key);
    setStatus('loading');
    setProgress(0);

    // Use the cached lookup when we already have it, so playback is instant.
    const url = key in urlCacheRef.current
      ? urlCacheRef.current[key]
      : await resolvePreviewUrl(song);
    urlCacheRef.current[key] = url ?? null;
    if (reqId !== reqIdRef.current) return; // a newer tap won

    if (!url) {
      // Never auto-open Spotify here: it starts playback in another app that we
      // cannot stop, which is what made music keep playing across screens.
      setActiveKey(null);
      setStatus('idle');
      setAvailability((prev) => ({ ...prev, [key]: 'unavailable' }));
      return;
    }

    try {
      if (!playerRef.current) {
        playerRef.current = createAudioPlayer({ uri: url }, { updateInterval: 250 });
        playerRef.current.addListener('playbackStatusUpdate', (st: any) => {
          if (st?.didJustFinish) {
            try { playerRef.current?.seekTo(0); } catch { /* noop */ }
            setActiveKey(null);
            setStatus('idle');
            setProgress(0);
          } else if (st?.isLoaded && st?.duration > 0) {
            setProgress(Math.min(1, (st.currentTime || 0) / st.duration));
          }
        });
      } else {
        playerRef.current.replace({ uri: url });
      }
      playerRef.current.seekTo(0);
      playerRef.current.play();
      if (reqId !== reqIdRef.current) return;
      setStatus('playing');
    } catch {
      setActiveKey(null);
      setStatus('idle');
    }
  }, [activeKey, status, stop]);

  return (
    <Ctx.Provider value={{ activeKey, status, progress, availability, checkAvailability, toggle, stop }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTrackPreview(): TrackPreviewCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTrackPreview must be used within a TrackPreviewProvider');
  return ctx;
}
