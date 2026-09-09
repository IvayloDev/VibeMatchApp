/**
 * Everything a freshly identified install needs, in one authenticated call.
 *
 * The client used to do all of this itself, in pieces, by writing credits into
 * its own storage: the starter grant, the daily match, and what it believed it
 * had bought. This is the server doing the same work from evidence it can
 * check, so the client never names a number.
 *
 * Order matters and is deliberate:
 *   1. the device starter, so a brand new install has something to spend
 *   2. the daily match, which tops up to one only if the balance is zero
 *   3. ONE RevenueCat lookup, used for BOTH the entitlement (Pro) and any
 *      credit packs this subscriber owns that we have no purchases row for
 *   4. the timezone, so next_free_at is computed in the user's own day
 *
 * Idempotent throughout. Every grant is rationed or keyed on a transaction id,
 * so calling this on every launch costs a few queries and grants nothing twice.
 *
 * `definite` says whether the RevenueCat half actually answered. The client
 * uses it to decide whether it may stop retrying: a lookup that failed looks
 * exactly like a subscriber who owns nothing, and the client must not treat
 * the two the same when deciding to drop its only local evidence.
 *
 * POST { deviceId?, starterMarkerPresent?, tzOffsetMinutes? } with the user's JWT
 *   -> 200 { balance, is_pro, next_free_at, pro_used_today, pro_daily_limit,
 *            free_daily_used, free_daily_limit, granted, definite }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CREDITS_PER_PRODUCT,
  PRO_ENTITLEMENT_ID,
  backfillAltTransactionId,
  corsHeaders,
  fetchSubscriber,
  isSandboxPurchase,
  json,
  platformFor,
  purchaseIds,
} from '../_shared/products.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* an empty body is fine */ }

  const deviceId = typeof body.deviceId === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(body.deviceId)
    ? body.deviceId
    : null;
  const markerPresent = body.starterMarkerPresent === true;
  const tzOffsetMinutes = Number.isInteger(body.tzOffsetMinutes) && Math.abs(body.tzOffsetMinutes) <= 14 * 60
    ? body.tzOffsetMinutes
    : null;

  const granted: Record<string, unknown> = {};

  try {
    // 1. The starter, once per device however many identities pass through it.
    if (deviceId) {
      const { data, error } = await admin.rpc('claim_device_starter', {
        p_device_id: deviceId,
        p_user: user.id,
        p_marker_present: markerPresent,
      });
      if (error) throw new Error(`claim_device_starter: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      granted.starter = row?.granted ?? 0;
      if (row?.already_claimed && row?.claimed_by && row.claimed_by !== user.id) {
        // Not an error: a reinstall, or a guest who signed up. Worth seeing in
        // the logs because it is also what farming would look like.
        console.log('device starter already claimed by another identity', {
          deviceId, now: user.id, before: row.claimed_by,
        });
      }
    }

    // 2. Today's free match. Tops up to one, never stacks.
    const { data: dailyGranted, error: dailyError } = await admin.rpc('claim_free_match_for', {
      p_user: user.id,
    });
    if (dailyError) throw new Error(`claim_free_match_for: ${dailyError.message}`);
    granted.daily = dailyGranted === true;

    // 3. The timezone, before reading state back, so next_free_at is right.
    if (tzOffsetMinutes !== null) {
      await admin.from('user_profiles')
        .update({ tz_offset_minutes: tzOffsetMinutes })
        .eq('user_id', user.id);
    }

    // 4. One RevenueCat lookup, two jobs.
    let definite = false;
    const rcSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
    if (rcSecret) {
      const look = await fetchSubscriber(rcSecret, user.id);
      if (look.ok) {
        definite = true;
        const sub = look.subscriber;

        // 4a. Pro. Backfills anyone who subscribed before the webhook existed.
        //
        // Authoritative in BOTH directions. This used to be an `if (ent)` with
        // no else, so RevenueCat saying "this user has no pro entitlement" was
        // read as "no news" and an active row survived forever - and an active
        // row means free scans, which is the direction a mistake must never
        // fall. The webhook can write a wrong row (a payload we misread, an
        // event we mishandled); this is the only thing that takes one back.
        //
        // Only ever on a lookup that SUCCEEDED. A failed lookup and a
        // subscriber who owns nothing are indistinguishable from here, and
        // clearing Pro on an outage would cancel a paying customer. The
        // remaining race - a receipt mid-transfer, whose entitlement has not
        // landed on this id yet - costs at most one launch, because the next
        // bootstrap or the next webhook writes it back.
        const ent = sub?.entitlements?.[PRO_ENTITLEMENT_ID];
        if (ent) {
          const expires = ent.expires_date ? new Date(ent.expires_date) : null;
          const active = !expires || expires.getTime() > Date.now();
          await admin.rpc('apply_entitlement', {
            p_user: user.id,
            p_product: ent.product_identifier ?? null,
            p_status: active ? 'active' : 'expired',
            p_expires: expires ? expires.toISOString() : null,
            p_source: 'session_bootstrap',
          });
        } else {
          // Read before writing, so the common case (a free user, every
          // launch) stays a single indexed select instead of an upsert that
          // rewrites the same row forever.
          const { data: existing } = await admin
            .from('entitlements')
            .select('status, product_id, source')
            .eq('user_id', user.id)
            .maybeSingle();
          if (existing?.status === 'active') {
            console.warn('clearing an active entitlement RevenueCat does not corroborate', {
              userId: user.id, product: existing.product_id, wroteBy: existing.source,
            });
            await admin.rpc('apply_entitlement', {
              p_user: user.id,
              p_product: existing.product_id ?? null,
              p_status: 'expired',
              p_expires: null,
              p_source: 'session_bootstrap_corrected',
            });
          }
        }

        // 4b. Credit packs RevenueCat knows about and we have no row for. This
        //     is what recovers a guest who bought before ever having an
        //     account, without the client ever asserting an amount.
        const nonSubs = sub?.non_subscriptions ?? {};
        for (const [productId, entries] of Object.entries(nonSubs)) {
          const credits = CREDITS_PER_PRODUCT[productId];
          if (!credits) continue;
          for (const p of (entries as any[]) ?? []) {
            // Sandbox sales are granted here too. See the long note in
            // validate-purchase: Apple's reviewer and every TestFlight tester
            // buy in sandbox, and bootstrap is the safety net that recovers a
            // purchase whose validation call failed. Skipping them here would
            // mean a reviewer who bought, got nothing, and relaunched still
            // gets nothing, which is the same rejection by a slower route.
            if (isSandboxPurchase(p)) {
              console.warn('🧪 sandbox purchase granted during bootstrap', { userId: user.id, productId });
            }
            const ids = purchaseIds(p);
            const platform = platformFor(p?.store);
            if (!ids.primary || !platform) continue;

            // Give any row this sale is already on its missing second id
            // before asking for the grant, so a row written under RevenueCat's
            // internal id before alt_transaction_id existed is matchable by
            // the store id the webhook will arrive with.
            await backfillAltTransactionId(admin, ids, { userId: user.id, productId, source: 'session_bootstrap' });

            const { error } = await admin.rpc('grant_purchase_credits', {
              p_user: user.id,
              p_product: productId,
              p_txn: ids.primary,
              p_platform: platform,
              p_credits: credits,
              p_source: 'session_bootstrap',
              p_alt_txn: ids.alternate,
            });
            if (error) console.error('pack reconcile failed', { txn: ids.primary, message: error.message });
          }
        }
      } else {
        console.warn('RevenueCat unavailable during bootstrap:', look.detail);
      }
    }

    // 5. Read the result back through the same function the app will use.
    const { data: stateRows, error: stateError } = await userClient.rpc('get_credit_state');
    if (stateError) throw new Error(`get_credit_state: ${stateError.message}`);
    const state = Array.isArray(stateRows) ? stateRows[0] : stateRows;

    return json({
      balance: state?.balance ?? 0,
      is_pro: state?.is_pro ?? false,
      // NULL means the free daily allowance is spent for good, not "unknown".
      // The client reads it with freeExhausted and stops promising a match
      // tomorrow that will never arrive.
      next_free_at: state?.next_free_at ?? null,
      pro_used_today: state?.pro_used_today ?? null,
      pro_daily_limit: state?.pro_daily_limit ?? 10,
      // Passed through as null when get_credit_state has not reported them, so
      // an app talking to a database that predates the lifetime cap renders a
      // dash rather than "0 of 30 used".
      free_daily_used: state?.free_daily_used ?? null,
      free_daily_limit: state?.free_daily_limit ?? 30,
      granted,
      definite,
    });
  } catch (err) {
    console.error('session-bootstrap failed:', err);
    // 503 rather than 500: everything here is idempotent and retrying is the
    // correct response, which is what the client does.
    return json({ error: 'Bootstrap failed', retryable: true }, 503);
  }
});
