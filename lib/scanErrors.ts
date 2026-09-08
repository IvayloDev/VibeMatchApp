/**
 * Turn a failed `recommend-songs` response into something honest to show a user.
 *
 * Every failure used to surface as "No Matches Found", which blames the user's
 * photo for problems that have nothing to do with it. That actually happened:
 * an exhausted OpenAI credit balance took scanning down, and the app told
 * everyone their photo had no match - the reading that makes a user conclude
 * the product is broken rather than come back later.
 *
 * The distinction that matters is "we looked and found nothing" versus "we
 * never got to look". Only the first is about their photo.
 */

export type ScanFailure = {
  title: string;
  message: string;
  /** True when trying again later is the right advice. */
  retryable: boolean;
  /** Short slug for analytics, so outages are separable from real misses. */
  reason: string;
};

const NOT_CHARGED = 'You have not been charged for this.';

/** Genuine "the model looked and nothing usable came back". */
export function noMatchFailure(message?: string): ScanFailure {
  return {
    title: 'No Matches Found',
    message: message || `We couldn't find songs that fit this photo. Try another one. ${NOT_CHARGED}`,
    retryable: false,
    reason: 'no_matches',
  };
}

/**
 * The photo could not be turned into the resized JPEG the upload needs.
 *
 * Nothing has been uploaded or charged at this point, and retrying the same
 * photo will fail the same way, so the honest advice is a different photo.
 */
export function imagePrepFailure(): ScanFailure {
  return {
    title: "Couldn't Use That Photo",
    message: `We couldn't prepare this photo for matching. Try another one. ${NOT_CHARGED}`,
    retryable: false,
    reason: 'image_prep_failed',
  };
}

/**
 * Classify a non-OK response body from the edge function.
 *
 * `data.code` is the reliable signal where present; otherwise the function's
 * `error` strings and the HTTP status are what we have.
 */
export function describeScanFailure(httpStatus: number, data: any): ScanFailure {
  const code = typeof data?.code === 'string' ? data.code : '';
  const error = typeof data?.error === 'string' ? data.error : '';
  const nested = data?.details?.error ?? {};
  const nestedCode = typeof nested?.code === 'string' ? nested.code : '';
  const nestedType = typeof nested?.type === 'string' ? nested.type : '';

  // The server refused before spending anything. Callers handle these; they
  // are here so nothing falls through to the catch-all, which apologises for
  // a failure that did not happen and tells the user to retry forever.
  if (httpStatus === 402 || code === 'insufficient_credits') {
    return {
      title: 'Out of Matches',
      message: `You're out of matches for now. ${NOT_CHARGED}`,
      retryable: false,
      reason: 'insufficient_credits',
    };
  }
  if (httpStatus === 409 && code === 'scan_in_flight') {
    return {
      title: 'Still Matching',
      message: `This photo is already being matched. ${NOT_CHARGED}`,
      retryable: false,
      reason: 'scan_in_flight',
    };
  }
  if (httpStatus === 409) {
    return {
      title: 'Already Matched',
      message: `We've already matched this photo. ${NOT_CHARGED}`,
      retryable: false,
      reason: 'scan_conflict',
    };
  }
  if (httpStatus === 401 || code === 'auth_required') {
    return {
      title: "Couldn't Start",
      message: `We couldn't set this match up just now. ${NOT_CHARGED} Please try again in a moment.`,
      retryable: true,
      reason: 'auth_required',
    };
  }

  // Music search is down (bad or expired Spotify credentials server-side).
  if (code === 'SPOTIFY_AUTH' || error === 'Spotify API error') {
    return {
      title: 'Music Search Unavailable',
      message: `Song search is temporarily unavailable, so we couldn't finish this match. Please try again shortly. ${NOT_CHARGED}`,
      retryable: true,
      reason: 'spotify_unavailable',
    };
  }

  // The AI account ran out of funds or hit a quota. Nothing the user can do,
  // and nothing about their photo.
  if (
    nestedCode === 'credit_balance_exhausted' ||
    nestedType === 'insufficient_quota' ||
    httpStatus === 429
  ) {
    return {
      title: 'Matching Unavailable',
      message: `Our matching service is temporarily unavailable. This is on us, not your photo - please try again a little later. ${NOT_CHARGED}`,
      retryable: true,
      reason: 'ai_quota_exhausted',
    };
  }

  // Anything else that clearly failed before or during the model call.
  if (
    error.startsWith('OpenAI request') ||
    error === 'Failed to parse OpenAI response' ||
    error === 'Failed to fetch or encode image' ||
    error === 'Server misconfiguration' ||
    httpStatus >= 500
  ) {
    return {
      title: 'Something Went Wrong',
      message: `We couldn't analyze your photo just now. Please try again in a moment. ${NOT_CHARGED}`,
      retryable: true,
      reason: 'service_error',
    };
  }

  // The function's own 404 for "resolved nothing on Spotify".
  if (httpStatus === 404 || error === 'No matches found') {
    return noMatchFailure(data?.message);
  }

  // Unknown shape: prefer the neutral, retryable wording over blaming the photo.
  return {
    title: 'Something Went Wrong',
    message: `We couldn't complete this match. Please try again. ${NOT_CHARGED}`,
    retryable: true,
    reason: 'unknown_error',
  };
}

/** No response at all - offline, DNS, timeout. */
export function networkScanFailure(): ScanFailure {
  return {
    title: 'Connection Problem',
    message: `We couldn't reach the matching service. Check your connection and try again. ${NOT_CHARGED}`,
    retryable: true,
    reason: 'network_error',
  };
}
