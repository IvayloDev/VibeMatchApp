import { posthog } from './posthog';

/**
 * Remote kill switches, read from PostHog feature flags.
 *
 * Every flag here defaults to OFF: an unknown value (flags not loaded yet,
 * PostHog disabled, no network) is treated as false, so a switch that is
 * meant to hide something never shows it by accident.
 *
 * `spotify_connect_enabled` gates the Spotify login prompt. The Spotify
 * developer app is in Development mode (5 allowlisted accounts), so listening
 * data only loads for those accounts; everyone else authorizes successfully
 * and then gets 403 on every API call. The prompt stays hidden for the public
 * and is switched on per tester distinct_id in PostHog, no release needed.
 */
export const SPOTIFY_CONNECT_FLAG = 'spotify_connect_enabled';

/** Ask PostHog for fresh flag values. Safe to call on every cold start. */
export async function primeFeatureFlags(): Promise<void> {
  try {
    const client: any = posthog;
    if (client && typeof client.reloadFeatureFlagsAsync === 'function') {
      await client.reloadFeatureFlagsAsync();
    }
  } catch (err) {
    console.warn('[flags] reload failed, keeping cached values:', err);
  }
}

/** Synchronous read of the cached flag value. Unknown counts as off. */
export function isFlagOn(key: string): boolean {
  try {
    const client: any = posthog;
    if (!client || typeof client.isFeatureEnabled !== 'function') return false;
    return client.isFeatureEnabled(key) === true;
  } catch {
    return false;
  }
}

export function isSpotifyConnectEnabled(): boolean {
  return isFlagOn(SPOTIFY_CONNECT_FLAG);
}
