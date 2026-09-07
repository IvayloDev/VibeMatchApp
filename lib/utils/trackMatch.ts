// Shared track-matching helpers used by every third-party catalog lookup
// (preview resolution, Apple Music links). Kept in one place so a fix to the
// normalization rules applies everywhere at once.

/** Normalize for comparison: lowercase, strip "(feat…)"/"- Live" decorations. */
export function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    // Edition suffixes after " - ". The year prefix matters: Spotify ships
    // "Drive Blind - 2001 Remaster" and "Jane Says - 2011 Remastered
    // Version", which the year-less pattern left untouched.
    .replace(
      /\s+-\s+(\d{4}\s+)?(feat\.?|ft\.?|with|live|remaster(ed)?(\s+version)?|deluxe|radio edit|single version|mono|stereo|anniversary edition|beat edit)(\s+\d{4})?.*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search term for a third-party catalog (iTunes, Deezer).
 *
 * Must use the cleaned title. Spotify's catalog title carries edition
 * suffixes, and passing one through as the query does not merely fail to
 * match, it derails the search itself: "Ride Drive Blind - 2001 Remaster"
 * returns a live Who track, while "Ride Drive Blind" returns the song.
 */
export function catalogQuery(artist: string, title: string): string {
  return `${(artist || '').trim()} ${norm(title)}`.trim();
}

export function artistMatches(candidate: string, want: string): boolean {
  const a = norm(candidate);
  return a === want || a.includes(want) || want.includes(a);
}
