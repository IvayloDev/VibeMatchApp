/**
 * The one place a product id becomes a number of credits.
 *
 * This map used to be copied into every function that granted anything, and
 * that is precisely how `dynamic-handler` survived: a forgotten second copy of
 * validate-purchase, with its own map and its own missing verification, still
 * deployed and still minting. Anything that grants imports from here.
 *
 * The copies drifted exactly as predicted. revenuecat-webhook kept its own
 * store map that did NOT list PLAY_STORE_SANDBOX while this one did, so the
 * same test purchase was refused on one path and granted real credits on the
 * other. Both private copies are gone; every function now reads this file, and
 * a decision made here is a decision made everywhere.
 */
export const CREDITS_PER_PRODUCT: Record<string, number> = {
  'tunematch_credits_5': 5,
  'tunematch_credits_18': 18,
  'tunematch_credits_60': 60,
  'tunematch_credits_150': 150,
};

/**
 * The subscription products that grant Pro, on both stores.
 *
 * Apple sells three separate product ids. Play sells ONE subscription
 * (`tunematch_pro`) with base plans hanging off it, which RevenueCat reports
 * either bare or as `tunematch_pro:pro-weekly`, so the Play side is matched by
 * prefix: a base plan added in the Play console (weekly was, three days ago)
 * must not silently stop granting Pro until someone remembers to edit this
 * list.
 */
const APPLE_PRO_PRODUCT_IDS = new Set([
  'tunematch_pro_weekly',
  'tunematch_pro_monthly',
  'tunematch_pro_annual',
]);
const PLAY_PRO_SUBSCRIPTION_ID = 'tunematch_pro';

/**
 * Is this product id one that actually sells Pro?
 *
 * apply_entitlement writes whatever product id it is handed, and both
 * charge_scan and get_credit_state read `status = 'active'` as Pro. So without
 * this gate any product id at all could become an entitlement: a REFUNDED
 * credit pack arrives as CANCELLATION, which the webhook treated as "still
 * active until the period ends", and the buyer became Pro. A credit pack is
 * never Pro, whatever event carries it.
 */
export function isProSubscriptionProduct(productId: string | undefined | null): boolean {
  const id = (productId ?? '').trim();
  if (!id) return false;
  if (id in CREDITS_PER_PRODUCT) return false;
  if (APPLE_PRO_PRODUCT_IDS.has(id)) return true;
  return id === PLAY_PRO_SUBSCRIPTION_ID || id.startsWith(`${PLAY_PRO_SUBSCRIPTION_ID}:`);
}

/**
 * public.purchases.platform is constrained to exactly these two values.
 *
 * PLAY_STORE_SANDBOX is deliberately NOT mapped any more. See
 * isSandboxPurchase for what a sandbox sale is and why it grants nothing.
 */
export function platformFor(store: string | undefined | null): string | null {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'ios';
    case 'PLAY_STORE':
      return 'android';
    default:
      return null;
  }
}

/**
 * A purchase nobody paid for.
 *
 * Sandbox sales come from Play license testers, TestFlight and Xcode builds,
 * and Apple's review team. RevenueCat reports them in three different shapes
 * depending on which door they arrive through, so all three are checked:
 *   - the webhook event's `environment`
 *   - a store id that names the sandbox outright (PLAY_STORE_SANDBOX)
 *   - `is_sandbox` on a /v1/subscribers non_subscriptions entry
 *
 * CREDITS are refused for these. A credit is permanent, spendable currency and
 * a tester can mint it repeatedly for nothing, which is what "grant on
 * PLAY_STORE_SANDBOX" was doing on two of the three paths.
 *
 * The Pro ENTITLEMENT is deliberately not refused on the same grounds: it
 * carries an expiry, sandbox subscriptions expire in minutes, every launch
 * re-derives it from RevenueCat, and refusing it would mean Apple's reviewer
 * subscribes in sandbox and is shown the paywall again, which fails the review
 * of the app's main purchase flow.
 */
export function isSandboxPurchase(
  input: { store?: unknown; environment?: unknown; is_sandbox?: unknown } | null | undefined,
): boolean {
  if (!input) return false;
  if (input.is_sandbox === true) return true;
  if (String(input.environment ?? '').toUpperCase() === 'SANDBOX') return true;
  return String(input.store ?? '').toUpperCase().endsWith('_SANDBOX');
}

export type SubscriberLookup =
  /**
   * The `never` fields are not decoration. This project compiles with
   * strictNullChecks off, and there a BOOLEAN discriminant does not narrow a
   * union: `if (!look.ok) console.log(look.detail)` was a type error at every
   * call site, which means the compiler was checking nothing inside the branch
   * that handles failure. Declaring each branch's absent fields as optional
   * `never` makes the union narrow again without changing a single caller.
   */
  | { ok: true; subscriber: any; retryable?: never; detail?: never }
  /**
   * We could not ask, or RevenueCat does not know this id yet. Never a verdict
   * about what the user owns: an alias that has not propagated looks exactly
   * like a subscriber who bought nothing, and treating the two the same is how
   * a real purchase gets written off.
   */
  | { ok: false; subscriber?: never; retryable: boolean; detail: string };

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

/**
 * The two ids one sale has, sorted into the two columns purchases keeps.
 *
 * RevenueCat gives every non-subscription purchase an internal id (`id`) and
 * carries the store's own transaction id beside it (`store_transaction_id`).
 * The store id is primary because it is the one BOTH the subscriber API and
 * the webhook expose, so every path converges on one row; the other id, when
 * there is one, rides along as the alternate. `alternate` is null only when
 * RevenueCat itself gave us a single id - never as a side effect of which
 * branch of a ternary ran.
 */
export function purchaseIds(entry: { id?: unknown; store_transaction_id?: unknown } | null | undefined): {
  primary: string | null;
  alternate: string | null;
} {
  const asId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const storeId = asId(entry?.store_transaction_id);
  const rcId = asId(entry?.id);
  const primary = storeId ?? rcId;
  const alternate = primary === storeId ? rcId : storeId;
  return { primary, alternate: alternate === primary ? null : alternate };
}

/**
 * Find the purchases row a sale is already recorded on, under either of its
 * ids and in either column.
 *
 * Written as two `.in()` queries rather than one `.or()` because a PostgREST
 * or-filter is a STRING the caller assembles, and store transaction ids are
 * not ours to trust with commas and parentheses. `.in()` is encoded by the
 * client.
 */
export async function findPurchaseByEitherId(
  admin: any,
  ids: Array<string | null | undefined>,
  columns = 'user_id, credits_granted, transaction_id, alt_transaction_id',
  scopeToUser: string | null = null,
): Promise<any | null> {
  const wanted = ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (wanted.length === 0) return null;

  for (const column of ['transaction_id', 'alt_transaction_id']) {
    let query = admin.from('purchases').select(columns).in(column, wanted).limit(1);
    if (scopeToUser) query = query.eq('user_id', scopeToUser);
    const { data, error } = await query;
    if (error) {
      console.error('purchase lookup failed', { column, message: error.message });
      return null;
    }
    if (Array.isArray(data) && data.length > 0) return data[0];
  }
  return null;
}

/**
 * Teach a purchases row its other id.
 *
 * alt_transaction_id was added on 2026-09-09 and never backfilled, so every
 * row written before that date holds RevenueCat's INTERNAL id in
 * transaction_id and NULL beside it. grant_purchase_credits refuses a
 * duplicate under either id, but a webhook arriving with the STORE id matches
 * neither column on those rows, inserts a second one, and grants the same sale
 * twice - the original double-grant bug, still live for every legacy buyer.
 *
 * A migration is the real fix and none can be written from here. What every
 * path that asks RevenueCat CAN do is repair the row it just matched, because
 * RevenueCat hands it both ids at once. The unmatchable set shrinks a little
 * every time a legacy buyer opens the app.
 *
 * Failures are logged and swallowed: this is a repair, never the reason a
 * customer's purchase does not go through. The one failure worth reading is a
 * violation of the partial unique index on alt_transaction_id, which means the
 * other id already belongs to a DIFFERENT row - two rows for one sale, a
 * support case rather than something to retry.
 */
export async function backfillAltTransactionId(
  admin: any,
  ids: { primary: string | null; alternate: string | null },
  context: Record<string, unknown> = {},
): Promise<void> {
  const { primary, alternate } = ids;
  if (!primary || !alternate || primary === alternate) return;

  // Whichever id the row was keyed on, the other one goes in the empty column.
  for (const [keyedOn, missing] of [[primary, alternate], [alternate, primary]]) {
    const { error } = await admin
      .from('purchases')
      .update({ alt_transaction_id: missing })
      .eq('transaction_id', keyedOn)
      .is('alt_transaction_id', null);
    if (error) {
      console.error('alt_transaction_id backfill failed', { ...context, keyedOn, message: error.message });
    }
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
