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
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CREDITS_PER_PRODUCT: Record<string, number> = {
  'tunematch_credits_5': 5,
  'tunematch_credits_18': 18,
  'tunematch_credits_60': 60,
  'tunematch_credits_150': 150,
};

/** purchases.platform is constrained to these two. */
function platformFor(store: string | undefined): string | null {
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RevenueCat identifies a subscriber by whatever the app told it. Signed-in
 * users are configured with the Supabase uid, but a purchase made before the
 * user signed in belongs to a RevenueCat anonymous id and only becomes ours
 * through an alias. So try the obvious id, then the original, then the aliases,
 * and confirm against auth.users before granting anything: an id that merely
 * looks like a uuid is not a user.
 */
async function resolveUser(admin: any, event: any): Promise<string | null> {
  const candidates: string[] = [
    event?.app_user_id,
    event?.original_app_user_id,
    ...(Array.isArray(event?.aliases) ? event.aliases : []),
  ].filter((v: unknown): v is string => typeof v === 'string' && UUID.test(v));

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

  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? '';
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
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const userId = await resolveUser(admin, event);

    // 200, not an error: this is a real event for somebody we have no account
    // for (a purchase made before the app ever signed in, most likely). Making
    // RevenueCat retry it forever would not produce an account.
    if (!userId) {
      console.warn('⚠️ webhook for an unknown subscriber, acknowledged without action', {
        type,
        app_user_id: event?.app_user_id ?? null,
      });
      return new Response(JSON.stringify({ ok: true, ignored: 'unknown subscriber' }), { status: 200 });
    }

    switch (type) {
      case 'NON_RENEWING_PURCHASE': {
        const productId = String(event?.product_id ?? '');
        const credits = CREDITS_PER_PRODUCT[productId];
        const platform = platformFor(event?.store);
        const txn = String(event?.transaction_id ?? event?.id ?? '');

        if (!credits || !platform || !txn) {
          console.warn('⚠️ non-renewing purchase we cannot map, acknowledged', { productId, store: event?.store, txn });
          return new Response(JSON.stringify({ ok: true, ignored: 'unmappable product' }), { status: 200 });
        }

        const { data, error } = await admin.rpc('grant_purchase_credits', {
          p_user: userId,
          p_product: productId,
          p_txn: txn,
          p_platform: platform,
          p_credits: credits,
          p_source: 'revenuecat_webhook',
        });
        if (error) throw new Error(`grant failed: ${error.message}`);

        const row = Array.isArray(data) ? data[0] : data;
        console.log(row?.granted ? '✅ webhook granted' : 'ℹ️ webhook duplicate, already granted', {
          userId, productId, txn, balance: row?.balance,
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
        await admin.rpc('apply_entitlement', {
          p_user: userId,
          p_product: String(event?.product_id ?? ''),
          p_status: 'active',
          p_expires: event?.expiration_at_ms ? new Date(Number(event.expiration_at_ms)).toISOString() : null,
          p_source: 'revenuecat_webhook',
        });
        console.log('✅ entitlement active', { userId, type });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      case 'CANCELLATION': {
        // Record it, keep access until the period ends.
        await admin.rpc('apply_entitlement', {
          p_user: userId,
          p_product: String(event?.product_id ?? ''),
          p_status: 'active',
          p_expires: event?.expiration_at_ms ? new Date(Number(event.expiration_at_ms)).toISOString() : null,
          p_source: 'revenuecat_webhook_cancelled',
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      case 'EXPIRATION':
      case 'BILLING_ISSUE': {
        await admin.rpc('apply_entitlement', {
          p_user: userId,
          p_product: String(event?.product_id ?? ''),
          p_status: type === 'EXPIRATION' ? 'expired' : 'billing_issue',
          p_expires: event?.expiration_at_ms ? new Date(Number(event.expiration_at_ms)).toISOString() : null,
          p_source: 'revenuecat_webhook',
        });
        console.log('ℹ️ entitlement ended', { userId, type });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      case 'TRANSFER': {
        // A receipt was reattached to a different app user id. Credits already
        // granted stay with the account that received them: moving a balance
        // between accounts automatically is a way to lose someone's credits to
        // a stranger's device, and this is rare enough to look at by hand.
        // Entitlement follows the receipt, which is what the stores intend.
        console.warn('🔀 TRANSFER event, entitlement moved, balances left alone for manual review', {
          to: event?.transferred_to ?? null,
          from: event?.transferred_from ?? null,
        });
        await admin.rpc('apply_entitlement', {
          p_user: userId,
          p_product: String(event?.product_id ?? ''),
          p_status: 'active',
          p_expires: event?.expiration_at_ms ? new Date(Number(event.expiration_at_ms)).toISOString() : null,
          p_source: 'revenuecat_webhook_transfer',
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
