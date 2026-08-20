// Apple Music links for result tracks.
//
// The recommendation pipeline resolves songs against Spotify, so every result
// carries a spotify_url and nothing else. Roughly half of installs are Android
// and a large share of the iOS base does not use Spotify at all, which left
// those users at a dead end on the one screen that delivers the payoff.
//
// This resolves an Apple Music web URL via the public iTunes Search API - the
// same endpoint already used for preview fallback, so no auth, no SDK, and no
// native build. `trackViewUrl` points at music.apple.com, which opens the Apple
// Music app when installed and the web player otherwise.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { norm, artistMatches } from './utils/trackMatch';

export type AppleMusicSong = {
  title: string;
  artist: string;
};

// Module-level cache so revisiting a result set (or re-rendering a row) never
// refetches. iTunes Search is rate limited per IP (~20 req/min), and a results
// screen resolves up to 6 tracks, so deduping matters.
const urlCache: Record<string, string | null> = {};
const inFlight: Record<string, Promise<string | null>> = {};

function cacheKey(song: AppleMusicSong): string {
  return `${norm(song.artist)}·${norm(song.title)}`;
}

async function lookup(song: AppleMusicSong): Promise<string | null> {
  try {
    const term = encodeURIComponent(`${song.artist} ${song.title}`.trim());
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10`);
    if (!r.ok) return null;
    const j = await r.json();
    const wantTitle = norm(song.title);
    const wantArtist = norm(song.artist);
    // Title must match EXACTLY once normalized. A substring test is not enough:
    // "cherry blossom".includes("cherry") is true, which is how a completely
    // different song ends up linked.
    const hit = (j?.results || []).find(
      (res: any) =>
        res?.trackViewUrl &&
        norm(res.trackName) === wantTitle &&
        artistMatches(res?.artistName ?? '', wantArtist)
    );
    return hit?.trackViewUrl ?? null;
  } catch {
    return null;
  }
}

/** Resolve an Apple Music URL, or null when the track genuinely isn't there. */
export async function resolveAppleMusicUrl(song: AppleMusicSong): Promise<string | null> {
  const key = cacheKey(song);
  if (key in urlCache) return urlCache[key];
  if (key in inFlight) return inFlight[key];

  const p = lookup(song).then((url) => {
    urlCache[key] = url;
    delete inFlight[key];
    return url;
  });
  inFlight[key] = p;
  return p;
}

/**
 * Resolve the Apple Music URL for a song. Returns null while loading and when
 * the track has no Apple Music match, so callers can simply hide the button.
 */
/**
 * Apple Music link for a song, or null.
 *
 * Android returns null on purpose: Apple Music is not a default there, the
 * button read as an out-of-place iOS affordance, and skipping it also saves an
 * iTunes Search lookup per track. Preview PLAYBACK is unaffected - that lives
 * in trackPreview.tsx and has its own Deezer/iTunes fallback.
 */
export function useAppleMusicUrl(song: AppleMusicSong): string | null {
  const key = cacheKey(song);
  const [url, setUrl] = useState<string | null>(() => urlCache[key] ?? null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    if (key in urlCache) {
      setUrl(urlCache[key]);
      return;
    }
    resolveAppleMusicUrl(song).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return Platform.OS === 'ios' ? url : null;
}
