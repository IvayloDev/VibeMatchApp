// Shared track-matching helpers used by every third-party catalog lookup
// (preview resolution, Apple Music links). Kept in one place so a fix to the
// normalization rules applies everywhere at once.

/** Normalize for comparison: lowercase, strip "(feat…)"/"- Live" decorations. */
export function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    .replace(/\s+-\s+(feat\.?|ft\.?|with|live|remaster(ed)?|deluxe|radio edit|single version).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function artistMatches(candidate: string, want: string): boolean {
  const a = norm(candidate);
  return a === want || a.includes(want) || want.includes(a);
}
