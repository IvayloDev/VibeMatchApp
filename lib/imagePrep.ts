import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Resize a picked photo off the critical path.
 *
 * The resize used to be awaited between the picker closing and the navigate,
 * so the user sat looking at Discover while a full-resolution photo was
 * decoded and re-encoded. It is the same work either way; the only question is
 * whether a screen transition waits for it. Now the picker starts it and
 * navigates on the next frame, and the one place that actually needs the bytes
 * (AnalyzingScreen, right before the upload) awaits the cached result, by
 * which time it has almost always finished.
 *
 * There is deliberately NO fallback to the raw camera-roll file. The upload
 * path is hardcoded for JPEG at every layer: buildImagePath always ends in
 * .jpg, the upload declares contentType 'image/jpeg', the guest storage INSERT
 * policy and both edge functions match a \.jpg$ pattern, and recommend-songs
 * derives the MIME it sends to the model from the path suffix alone. A raw
 * iOS pick is frequently .heic (the picker copies the original verbatim at
 * quality 1), so substituting it would push HEIC bytes into the bucket
 * labelled as JPEG, get them rejected by the vision model, and surface to the
 * user as a connection problem. A failed prep resolves to null instead and the
 * caller has to treat that as a failed scan.
 */

// What the two pickers did inline before this module existed. Changing these
// changes the bytes that reach storage and the model.
const TARGET_WIDTH = 800;
const COMPRESS = 0.7;

// Only the most recent picks can still be asked for (a re-pick in onboarding,
// and the scan retry after a pack purchase). Keys are unique per pick, so
// without a cap this map would grow for the life of the process.
const MAX_ENTRIES = 3;

type PrepEntry = {
  promise: Promise<string | null>;
  /** Resolved output, so a screen can seed its first render without awaiting. */
  uri: string | null;
};

const entries = new Map<string, PrepEntry>();
// Everything this module has produced, so a prepared uri handed back in is
// returned unchanged rather than resized and compressed a second time.
const outputs = new Set<string>();

function evictOldest() {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    const stale = entries.get(oldest.value);
    if (stale?.uri) outputs.delete(stale.uri);
    entries.delete(oldest.value);
  }
}

/**
 * Begin preparing a freshly picked photo. Fire and forget on purpose: the
 * stored promise is already guarded, so a failure can never surface as an
 * unhandled rejection when the user backs out before the scan.
 */
export function startImagePrep(rawUri: string): void {
  if (!rawUri || outputs.has(rawUri) || entries.has(rawUri)) return;

  const entry: PrepEntry = {
    uri: null,
    promise: ImageManipulator.manipulateAsync(
      rawUri,
      [{ resize: { width: TARGET_WIDTH } }],
      { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
    )
      .then((result) => {
        entry.uri = result.uri;
        outputs.add(result.uri);
        return result.uri;
      })
      .catch((error) => {
        console.log('[imagePrep] Failed to prepare image:', error);
        // Drop the entry so a later attempt (the scan re-run after a pack
        // purchase) gets a real second try instead of a cached failure.
        entries.delete(rawUri);
        return null;
      }),
  };

  entries.set(rawUri, entry);
  evictOldest();
}

/**
 * The resized JPEG for a picked photo, or null if it could not be produced.
 * Starts the work if nothing did, so an evicted entry re-prepares rather than
 * quietly handing back the original.
 */
export function getPreparedImage(rawUri: string): Promise<string | null> {
  if (!rawUri) return Promise.resolve(null);
  // Already one of our outputs: prepared, and resizing it again would just
  // compress an 800px JPEG a second time.
  if (outputs.has(rawUri)) return Promise.resolve(rawUri);
  if (!entries.has(rawUri)) startImagePrep(rawUri);
  return entries.get(rawUri)?.promise ?? Promise.resolve(null);
}

/**
 * The prepared uri if it is ready right now, without waiting. Screens use this
 * to seed their first render, so the normal case (prep finished during the
 * screen transition) never puts the full-resolution original on screen at all.
 */
export function peekPreparedImage(rawUri: string): string | null {
  if (!rawUri) return null;
  if (outputs.has(rawUri)) return rawUri;
  return entries.get(rawUri)?.uri ?? null;
}
