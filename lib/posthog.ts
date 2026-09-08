import PostHog from 'posthog-react-native';

// Public project API key (safe to ship in the client, same as Supabase anon key).
// Get it from PostHog: Project Settings -> Project API Key (starts with "phc_").
const POSTHOG_API_KEY = 'phc_regWa4zVfdcvwiW5KEtbniaWadLSA3QBbreBxSkQLVJX';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

// Analytics stays disabled until a real key is pasted in, so the app
// never sends events to a dead endpoint during development.
const enabled = POSTHOG_API_KEY.startsWith('phc_') && !POSTHOG_API_KEY.includes('REPLACE_ME');

export const posthog: PostHog | null = enabled
  ? new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // Application Installed / Opened / Backgrounded: the events every
      // retention curve is built on. Explicit so a future default change
      // cannot silently switch them off.
      captureAppLifecycleEvents: true,
      // Uncaught JS errors and unhandled promise rejections go to Error
      // Tracking on their own. Without this a crash was invisible unless the
      // user wrote in.
      errorTracking: { autocapture: true },
    })
  : null;

if (!enabled) {
  console.log('[PostHog] Disabled - no API key set in lib/posthog.ts');
}

// Tie events to the Supabase user id so RevenueCat, Supabase and PostHog
// all share the same identifier.
export function identifyUser(userId: string, properties?: Record<string, any>) {
  posthog?.identify(userId, properties);
}

export function resetUser() {
  posthog?.reset();
}

export function trackScreen(name: string) {
  posthog?.screen(name);
}

export function trackEvent(name: string, properties?: Record<string, any>) {
  posthog?.capture(name, properties);
}

/**
 * A caught error worth seeing in Error Tracking: something the app recovered
 * from but that stopped the user getting what they came for. Pair it with a
 * trackEvent that names the outcome so funnels and errors line up.
 */
export function trackError(error: unknown, properties?: Record<string, any>) {
  posthog?.captureException(error, properties);
}

/**
 * Attach properties to every subsequent event from this device (PostHog "super
 * properties"). Use for cohort dimensions you want to segment the whole funnel
 * by - e.g. whether the user has a streaming taste profile - so downstream
 * screens don't each have to plumb the value through.
 *
 * Deliberately not `$set`: person properties don't stick for anonymous guests,
 * which is most of the pre-registration funnel.
 */
export function registerSuperProperties(properties: Record<string, any>) {
  posthog?.register(properties);
}
