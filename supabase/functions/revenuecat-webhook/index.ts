/**
 * RevenueCat webhook: the purchase path that does not depend on the client.
 *
 * WHY IT EXISTS
 *
 * Today a purchase only becomes credits if the app calls validate-purchase and
 * that call succeeds. A customer who is charged and then loses connectivity,
 * force-quits, or hits a RevenueCat outage gets nothing until they reopen the
 * Pro screen and the queued retry happens to work. RevenueCat, meanwhile, knows
 * the purchase happened and will keep telling us so until we acknowledge it.
 *
 * It is also what makes Pro real to the server. Until now `isPro` lived only in
 * the client, so charge_scan could not tell a subscriber from anyone else and
 * would spend their credits. This populates public.entitlements, which
 * charge_scan already reads.
 *
 * AUTHENTICATION
 *
 * RevenueCat cannot present a Supabase JWT, so this function is deployed with
 * --no-verify-jwt and does its own check: the Authorization header must equal
 * REVENUECAT_WEBHOOK_AUTH exactly. Set the same value in the RevenueCat
 * dashboard under Integrations -> Webhooks -> Authorization header. Without the
 * secret set, the function refuses everything rather than trusting the caller:
 * this endpoint grants credits, and an open one is the hole we just spent the
 * day closing in two other places.
 *
 * IDEMPOTENCY
 *
 * Every grant goes through grant_purchase_credits, which keys on the store
 * transaction id and the UNIQUE constraint on purchases.transaction_id. So a
 * replayed webhook, a client retry, and both racing all converge on one row and
 * one grant. RevenueCat retries on any non-2xx, which is why an event we
 * understand but cannot act on still answers 200: retrying it forever would
 * never help.
 *
 * WHAT IT REFUSES TO WRITE
 *
 * An entitlement, unless the event is about a product we sell as a
 * subscription AND carries an end date. Both gates exist because
 * apply_entitlement believes what it is told and get_credit_state reads an
 * active row with a NULL expires_at as Pro that never ends. See isProEvent.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CREDITS_PER_PRODUCT,
  PRO_ENTITLEMENT_ID,
  backfillAltTransactionId,
  fetchSubscriber,
  isProSubscriptionProduct,
  isSandboxPurchase,
  platformFor,
  purchaseIds,
} from '../_shared/products.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Flatten the id fields RevenueCat uses, keeping only things shaped like a uid. */
function uidCandidates(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string' && UUID.test(v) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/**
 * RevenueCat identifies a subscriber by whatever the app told it. Signed-in
 * users are configured with the Supabase uid, but a purchase made before the
 * user signed in belongs to a RevenueCat anonymous id and only becomes ours
 * through an alias. So try the candidates in order and confirm each against
 * our own table before granting anything: an id that merely looks like a uuid
 * is not a user.
 */
async function resolveUser(admin: any, candidates: string[]): Promise<string | null> {
  for (const id of candidates) {
    const { data, error } = await admin
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', id)
      .maybeSingle();
    if (!error && data?.user_id) return data.user_id;
  }
  return null;
}

/**
 * Which account this event is about.
 *
 * TRANSFER is the one that used to be wrong, and wrong in the direction that
 * gives away Pro: on a transfer `original_app_user_id` is the account that just
 * LOST the receipt, and it was second in the candidate list, so a transfer away
 * from an account could refresh Pro ON that account. The receipt's new owner is
 * `transferred_to` and nothing else.
 */
function subjectIds(event: any, type: string): string[] {
  if (type === 'TRANSFER') return uidCandidates(event?.transferred_to);
  return uidCandidates(event?.app_user_id, event?.original_app_user_id, event?.aliases);
}

/** The end of the paid period, or null when the event does not carry one. */
function expiryOf(event: any): string | null {
  const ms = Number(event?.expiration_at_ms);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * Does this event say anything about Pro at all?
 *
 * Two gates, both required.
 *
 * The product must be one we sell as a subscription. apply_entitlement writes
 * the product id it is handed and never asks what it is, so before this check
 * ANY product could become Pro - including a REFUNDED credit pack, which
 * RevenueCat reports as CANCELLATION exactly like a cancelled subscription,
 * landing it in the branch that writes status 'active'.
 *
 * And the entitlement ids, when the payload carries them, must include `pro`.
 * That is the same fact session-bootstrap reads out of /v1/subscribers, so the
 * push path and the pull path now decide Pro from the same evidence.
 * RevenueCat sends `entitlement_ids: null` on events that touch no
 * entitlement, so a missing list falls through to the product gate rather than
 * counting as agreement.
 */
function isProEvent(event: any): boolean {
  if (!isProSubscriptionProduct(event?.product_id)) return false;
  const ids = Array.isArray(event?.entitlement_ids)
    ? event.entitlement_ids
    : typeof event?.entitlement_id === 'string'
      ? [event.entitlement_id]
      : null;
  return ids === null || ids.length === 0 || ids.includes(PRO_ENTITLEMENT_ID);
}

/**
 * The one shape that legitimately has no end date: an entitlement granted by
 * hand in the RevenueCat dashboard, which arrives from the PROMOTIONAL store
 * with no expiration. Anything else reaching us with a null expiry is a
 * payload we do not understand, and writing it as active would be Pro forever,
 * because nothing in the schema ever expires a row with no expires_at.
 */
function isNonExpiringGrant(event: any): boolean {
  return String(event?.store ?? '').toUpperCase() === 'PROMOTIONAL';
}

/**
 * Write Pro, or explain in one word why not.
 *
 * Every entitlement write in this function goes through here, in both
 * directions. Revocations are gated on the same "is this about Pro" test as
 * grants: entitlements holds one row per user, so an EXPIRATION for an
 * unrelated product would otherwise mark a paying subscriber expired.
 */
async function applyProEntitlement(
  admin: any,
  event: any,
  userId: string,
  status: 'active' | 'expired' | 'billing_issue',
  source: string,
): Promise<string> {
  if (!isProEvent(event)) return 'not a pro subscription event';

  const expires = expiryOf(event);
  if (status === 'active' && !expires && !isNonExpiringGrant(event)) {
    // Refused rather than guessed. session-bootstrap re-derives Pro from
    // RevenueCat on the next launch and corrects both directions, so the cost
    // of refusing is at most one launch of under-granting; the cost of writing
    // it would be permanent Pro for anyone whose refund we mishandled.
    return 'active with no expiry';
  }

  const { error } = await admin.rpc('apply_entitlement', {
    p_user: userId,
    p_product: String(event?.product_id ?? ''),
    p_status: status,
    p_expires: expires,
    p_source: source,
  });
  if (error) throw new Error(`apply_entitlement: ${error.message}`);
  return 'written';
}

/** Compare without leaking the answer through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * First 8 hex of a SHA-256, for telling two secrets apart in a log line without
 * recording either. Useless for recovering the value, sufficient for answering
 * "are these the same string".
 */
async function shortFingerprint(value: string): Promise<string> {
  if (!value) return '(empty)';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok');
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const env = (name: string): string => Deno.env.get(name) ?? '';

  const expected = env('REVENUECAT_WEBHOOK_AUTH');
  if (!expected) {
    console.error('🚨 REVENUECAT_WEBHOOK_AUTH is not set; refusing every event rather than trusting the caller');
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 503 });
  }
  // RevenueCat sends this field verbatim, and its own placeholder reads
  // "e.g. Bearer Xz3aHx...", so a value pasted with the scheme in front is the
  // normal case rather than a mistake. A paste can also pick up whitespace.
  // Accept both shapes, compare the secret itself.
  const presented = (req.headers.get('Authorization') ?? '').trim();
  const offered = presented.replace(/^Bearer\s+/i, '');
  const wanted = expected.trim().replace(/^Bearer\s+/i, '');

  if (!timingSafeEqual(offered, wanted)) {
    // Enough to tell a wrong secret from a wrong SHAPE, without putting either
    // value in the logs. A length difference means the two sides hold
    // different strings; equal lengths with different fingerprints means the
    // same shape but a stale copy on one side.
    console.warn('🚫 webhook rejected', {
      presentedLength: offered.length,
      expectedLength: wanted.length,
      hadBearerPrefix: presented !== offered,
      presentedFingerprint: await shortFingerprint(offered),
      expectedFingerprint: await shortFingerprint(wanted),
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 });
  }

  const event = payload?.event ?? payload;
  const type = String(event?.type ?? '').toUpperCase();

  const admin = createClient(
    env('SUPABASE_URL'),
    env('SUPABASE_SERVICE_ROLE_KEY') || env('SERVICE_ROLE_KEY')
  );

  try {
    const userId = await resolveUser(admin, subjectIds(event, type));

    // 200, not an error: this is a real event for somebody we have no account
    // for (a purchase made before the app ever signed in, most likely). Making
    // RevenueCat retry it forever would not produce an account.
    if (!userId) {
      console.warn('⚠️ webhook for an unknown subscriber, acknowledged without action', {
        type,
        app_user_id: event?.app_user_id ?? null,
        transferred_to: event?.transferred_to ?? null,
      });
      return new Response(JSON.stringify({ ok: true, ignored: 'unknown subscriber' }), { status: 200 });
    }

    switch (type) {
      case 'NON_RENEWING_PURCHASE': {
        const productId = String(event?.product_id ?? '');
        const credits = CREDITS_PER_PRODUCT[productId];
        const platform = platformFor(event?.store);
        const txn = String(event?.transaction_id ?? event?.id ?? '');

        // Sandbox purchases are granted on this path too, so the webhook and
        // the client agree. If the webhook refused while validate-purchase
        // granted, the same tester sale would be granted or not depending on
        // which path won the race, which is the divergence the shared product
        // module exists to prevent. See validate-purchase for why granting is
        // the right call: App Review buys in sandbox.
        if (isSandboxPurchase(event)) {
          console.warn('🧪 sandbox purchase, granting', {
            userId, productId, store: event?.store ?? null, environment: event?.environment ?? null,
          });
        }

        if (!credits || !platform || !txn) {
          console.warn('⚠️ non-renewing purchase we cannot map, acknowledged', { productId, store: event?.store, txn });
          return new Response(JSON.stringify({ ok: true, ignored: 'unmappable product' }), { status: 200 });
        }

        // The webhook only ever sees the STORE id, and rows written before
        // alt_transaction_id existed are keyed on RevenueCat's INTERNAL id with
        // nothing beside it. Those two strings never meet, so the dedupe misses
        // and the same sale is granted twice - the exact double-grant this all
        // exists to prevent. RevenueCat holds both ids for the sale, so ask.
        // Best effort: an outage here must not stop a genuine purchase, it only
        // costs us the second id.
        let ids = { primary: txn, alternate: null as string | null };
        const rcSecret = env('REVENUECAT_SECRET_API_KEY');
        if (rcSecret) {
          const lookupId = typeof event?.app_user_id === 'string' && event.app_user_id ? event.app_user_id : userId;
          const look = await fetchSubscriber(rcSecret, lookupId);
          if (look.ok) {
            const entries: any[] = look.subscriber?.non_subscriptions?.[productId] ?? [];
            const match = entries.find((p) => p?.store_transaction_id === txn || p?.id === txn);
            if (match) {
              // The sandbox flag the event did not carry: the subscriber
              // record marks test purchases with is_sandbox whatever store
              // they came from. Granted, like every other sandbox path here.
              if (isSandboxPurchase(match)) {
                console.warn('🧪 sandbox purchase (per RevenueCat), granting', { userId, productId, txn });
              }
              const both = purchaseIds(match);
              if (both.primary) ids = both;
            }
          } else {
            console.warn('RevenueCat unavailable, granting on the store id alone', { txn, detail: look.detail });
          }
        }

        // Repair the row this sale may already be on, so a future event of any
        // shape finds it under either id.
        await backfillAltTransactionId(admin, ids, { userId, productId, source: 'revenuecat_webhook' });

        const { data, error } = await admin.rpc('grant_purchase_credits', {
          p_user: userId,
          p_product: productId,
          p_txn: ids.primary,
          p_platform: platform,
          p_credits: credits,
          p_source: 'revenuecat_webhook',
          p_alt_txn: ids.alternate,
        });
        if (error) throw new Error(`grant failed: ${error.message}`);

        const row = Array.isArray(data) ? data[0] : data;
        console.log(row?.granted ? '✅ webhook granted' : 'ℹ️ webhook duplicate, already granted', {
          userId, productId, txn: ids.primary, balance: row?.balance,
        });
        return new Response(JSON.stringify({ ok: true, granted: !!row?.granted }), { status: 200 });
      }

      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'PRODUCT_CHANGE':
      case 'SUBSCRIPTION_EXTENDED': {
        // CANCELLATION is deliberately not here: in RevenueCat it means
        // auto-renew was turned off, not that access ended. Access ends at
        // EXPIRATION, and treating a cancellation as the end would take Pro
        // away from someone who has paid through the end of their period.
        const outcome = await applyProEntitlement(admin, event, userId, 'active', 'revenuecat_webhook');
        console.log('ℹ️ entitlement event', { userId, type, outcome });
        return new Response(JSON.stringify({ ok: true, entitlement: outcome }), { status: 200 });
      }

      case 'CANCELLATION': {
        // Record it, keep access until the period ends.
        //
        // This branch is why isProEvent exists. RevenueCat also sends
        // CANCELLATION when a NON-RENEWING purchase is refunded, so a refunded
        // credit pack arrived here, was written as an active entitlement with
        // no expiry, and made the buyer Pro for good - paid for with a refund.
        const outcome = await applyProEntitlement(admin, event, userId, 'active', 'revenuecat_webhook_cancelled');
        console.log('ℹ️ cancellation', { userId, product: event?.product_id ?? null, outcome });
        return new Response(JSON.stringify({ ok: true, entitlement: outcome }), { status: 200 });
      }

      case 'EXPIRATION':
      case 'BILLING_ISSUE': {
        const outcome = await applyProEntitlement(
          admin, event, userId, type === 'EXPIRATION' ? 'expired' : 'billing_issue', 'revenuecat_webhook',
        );
        console.log('ℹ️ entitlement ended', { userId, type, outcome });
        return new Response(JSON.stringify({ ok: true, entitlement: outcome }), { status: 200 });
      }

      case 'TRANSFER': {
        // A receipt was reattached to a different app user id. Credits already
        // granted stay with the account that received them: moving a balance
        // between accounts automatically is a way to lose someone's credits to
        // a stranger's device, and this is rare enough to look at by hand.
        // Entitlement follows the receipt, which is what the stores intend -
        // and it has to move in BOTH directions, or the account that lost the
        // receipt keeps free Pro scans it no longer pays for.
        const toOutcome = await applyProEntitlement(admin, event, userId, 'active', 'revenuecat_webhook_transfer');

        let fromOutcome = 'no known from-account';
        const fromId = await resolveUser(admin, uidCandidates(event?.transferred_from));
        if (fromId && fromId !== userId) {
          fromOutcome = await applyProEntitlement(admin, event, fromId, 'expired', 'revenuecat_webhook_transfer');
        }

        console.warn('🔀 TRANSFER event, entitlement moved, balances left alone for manual review', {
          to: userId, toOutcome, from: fromId, fromOutcome,
        });
        return new Response(JSON.stringify({ ok: true, entitlement: toOutcome }), { status: 200 });
      }

      default:
        console.log('ℹ️ webhook event ignored', { type });
        return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });
    }
  } catch (err) {
    // 500 so RevenueCat retries. This is the branch for a database that was
    // briefly unreachable, not for an event we understood and declined.
    console.error('❌ webhook failed, asking RevenueCat to retry:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
});
