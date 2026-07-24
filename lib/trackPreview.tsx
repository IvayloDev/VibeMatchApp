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

type TrackPreviewCtx = {
  activeKey: string | null;
  status: Status;
  progress: number; // 0..1 for the active track
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

/**
 * Try Spotify's clip first, then iTunes Search.
 *
 * iTunes fuzzy-matches, so we MUST verify the result is actually the requested
 * track — searching "Lana Del Rey Cherry" returns "Cherry Blossom" first, which
 * would silently play the wrong song. Require both artist and title to match;
 * otherwise return null so the caller falls back to opening Spotify.
 */
async function resolvePreviewUrl(song: PreviewSong): Promise<string | null> {
  if (song.preview_url) return song.preview_url;
  try {
    const term = encodeURIComponent(`${song.artist} ${song.title}`.trim());
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10`);
    if (!r.ok) return null;
    const j = await r.json();
    const wantTitle = norm(song.title);
    const wantArtist = norm(song.artist);

    // Title must match EXACTLY once normalized. A substring test is not enough:
    // "cherry blossom".includes("cherry") is true, which is how the wrong song
    // got played. Better to play nothing (and open Spotify) than the wrong track.
    const match = (j?.results || []).find((res: any) => {
      if (!res?.previewUrl) return false;
      const a = norm(res.artistName);
      const artistOk = a === wantArtist || a.includes(wantArtist) || wantArtist.includes(a);
      return artistOk && norm(res.trackName) === wantTitle;
    });

    return match?.previewUrl ?? null;
  } catch {
    return null;
  }
}

export function TrackPreviewProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const reqIdRef = useRef(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);

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

    const url = await resolvePreviewUrl(song);
    if (reqId !== reqIdRef.current) return; // a newer tap won

    if (!url) {
      setActiveKey(null);
      setStatus('idle');
      if (song.spotify_url) Linking.openURL(song.spotify_url); // fall back to full track
      else Alert.alert('No preview', 'Could not find a preview for this track.');
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

  return <Ctx.Provider value={{ activeKey, status, progress, toggle, stop }}>{children}</Ctx.Provider>;
}

export function useTrackPreview(): TrackPreviewCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTrackPreview must be used within a TrackPreviewProvider');
  return ctx;
}
