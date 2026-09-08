/**
 * The one place a product id becomes a number of credits.
 *
 * This map used to be copied into every function that granted anything, and
 * that is precisely how `dynamic-handler` survived: a forgotten second copy of
 * validate-purchase, with its own map and its own missing verification, still
 * deployed and still minting. Anything that grants imports from here.
 */
export const CREDITS_PER_PRODUCT: Record<string, number> = {
  'tunematch_credits_5': 5,
  'tunematch_credits_18': 18,
  'tunematch_credits_60': 60,
  'tunematch_credits_150': 150,
};

/** public.purchases.platform is constrained to exactly these two values. */
export function platformFor(store: string | undefined | null): string | null {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'ios';
    case 'PLAY_STORE':
    case 'PLAY_STORE_SANDBOX':
      return 'android';
    default:
      return null;
  }
}

export type SubscriberLookup =
  | { ok: true; subscriber: any }
  /**
   * We could not ask, or RevenueCat does not know this id yet. Never a verdict
   * about what the user owns: an alias that has not propagated looks exactly
   * like a subscriber who bought nothing, and treating the two the same is how
   * a real purchase gets written off.
   */
  | { ok: false; retryable: boolean; detail: string };

export async function fetchSubscriber(secret: string, uid: string): Promise<SubscriberLookup> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return { ok: false, retryable: true, detail: `network: ${err}` };
  }
  if (resp.status === 404) {
    return { ok: false, retryable: true, detail: 'no such subscriber yet' };
  }
  if (resp.status === 401 || resp.status === 403 || resp.status === 429 || resp.status >= 500) {
    return { ok: false, retryable: true, detail: `http ${resp.status}` };
  }
  if (!resp.ok) {
    return { ok: false, retryable: false, detail: `http ${resp.status}` };
  }
  try {
    return { ok: true, subscriber: (await resp.json())?.subscriber ?? {} };
  } catch (err) {
    return { ok: false, retryable: true, detail: `bad json: ${err}` };
  }
}

/** Must match PRO_ENTITLEMENT_ID in lib/revenuecat.ts. */
export const PRO_ENTITLEMENT_ID = 'pro';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
