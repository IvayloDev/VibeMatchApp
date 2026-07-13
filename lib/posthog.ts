import PostHog from 'posthog-react-native';

// Public project API key (safe to ship in the client, same as Supabase anon key).
// Get it from PostHog: Project Settings -> Project API Key (starts with "phc_").
const POSTHOG_API_KEY = 'phc_regWa4zVfdcvwiW5KEtbniaWadLSA3QBbreBxSkQLVJX';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

// Analytics stays disabled until a real key is pasted in, so the app
// never sends events to a dead endpoint during development.
const enabled = POSTHOG_API_KEY.startsWith('phc_') && !POSTHOG_API_KEY.includes('REPLACE_ME');

export const posthog: PostHog | null = enabled
  ? new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST })
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
