/**
 * Recover a legacy guest's paid credits, from RevenueCat's record and never
 * from the device's claim.
 *
 * THE SITUATION THIS EXISTS FOR
 *
 * Before this release a guest's balance was a number in AsyncStorage and their
 * receipts were a list beside it. Nothing about either reached a server: no
 * validation, no purchases row, no record the sale happened. Somebody out
 * there paid for a pack and the only evidence is on their phone.
 *
 * WHY IT DOES NOT TRUST THE SNAPSHOT
 *
 * The obvious implementation is "grant whatever the device says it had left".
 * That would hand the balance back to the person who bought it, and also to
 * anyone who edited one JSON value, on a key the client authors itself. It
 * would reopen the exact hole this release closes, in the release that closes
 * it. So the snapshot is used for ONE thing: telling us, in the logs, when a
 * device claims more than RevenueCat can corroborate, which is a support case
 * for a human rather than an automatic grant.
 *
 * Every credit granted here is keyed to a transaction id RevenueCat itself
 * returned, through the same grant_purchase_credits every other path uses, so
 * it converges on one purchases row and cannot double-grant.
 *
 * WHY `definite` MATTERS MORE THAN `ok`
 *
 * The client deletes its local balance only when this says definite. A failed
 * lookup and a subscriber who genuinely owns nothing are indistinguishable
 * from here, and an alias that has not propagated yet looks like both. Any
 * doubt means the client keeps its evidence and tries again next launch.
 *
 * POST { snapshot?: { localCredits, purchases: [{transactionId, productId, credits}] } }
 *   with the user's JWT
 *   -> 200 { ok, definite, grantedFromRc, balance, shortfall[] }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CREDITS_PER_PRODUCT,
  corsHeaders,
  fetchSubscriber,
  json,
  platformFor,
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

  const rcSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
  if (!rcSecret) {
    // Without the key nothing can be corroborated, and granting on the
    // device's word is the one thing this function exists not to do.
    console.error('recover-legacy-purchases: REVENUECAT_SECRET_API_KEY is not set');
    return json({ ok: false, definite: false, retryable: true, error: 'Not configured' }, 503);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* snapshot is optional */ }
  const claimed: Array<{ transactionId?: string; productId?: string }> =
    Array.isArray(body?.snapshot?.purchases) ? body.snapshot.purchases : [];

  const look = await fetchSubscriber(rcSecret, user.id);
  if (!look.ok) {
    // Nothing granted, nothing concluded. The client keeps its keys.
    console.warn('recover-legacy-purchases: lookup failed', { userId: user.id, detail: look.detail });
    return json({ ok: false, definite: false, retryable: look.retryable, detail: look.detail }, 200);
  }

  let grantedFromRc = 0;
  let orphaned = 0;
  const seenTxns = new Set<string>();

  try {
    const nonSubs = look.subscriber?.non_subscriptions ?? {};
    for (const [productId, entries] of Object.entries(nonSubs)) {
      const credits = CREDITS_PER_PRODUCT[productId];
      if (!credits) {
        // Loudly, rather than defaulting to a number. An unknown product here
        // means the catalogue changed and this map did not.
        console.error('recover-legacy-purchases: unknown product from RevenueCat', { productId });
        continue;
      }
      for (const p of (entries as any[]) ?? []) {
        const txn: string | undefined = p?.id ?? p?.store_transaction_id;
        const platform = platformFor(p?.store);
        if (!txn || !platform) continue;
        seenTxns.add(txn);

        const { data, error } = await admin.rpc('grant_purchase_credits', {
          p_user: user.id,
          p_product: productId,
          p_txn: txn,
          p_platform: platform,
          p_credits: credits,
          p_source: 'legacy_recovery',
        });
        if (error) throw new Error(`grant_purchase_credits: ${error.message}`);

        const row = Array.isArray(data) ? data[0] : data;
        if (row?.granted) {
          grantedFromRc += credits;
          continue;
        }

        // Already granted. To whom?
        const { data: existing } = await admin
          .from('purchases')
          .select('user_id')
          .eq('transaction_id', txn)
          .maybeSingle();
        if (existing?.user_id && existing.user_id !== user.id) {
          // The receipt is attached to this identity but the credits went to a
          // different account. Real money, two accounts, and no safe automatic
          // answer: moving a balance between accounts is how a purchase ends up
          // on a stranger's device. Flagged for a human.
          orphaned += 1;
          console.error('legacy_orphan_purchase', {
            transactionId: txn, productId, creditedTo: existing.user_id, claimedBy: user.id,
          });
        }
      }
    }
  } catch (err) {
    console.error('recover-legacy-purchases failed mid-grant:', err);
    return json({ ok: false, definite: false, retryable: true }, 200);
  }

  // What the device says it bought that RevenueCat has never heard of. Not
  // granted, only reported: this is the line a support conversation starts on.
  const shortfall = claimed
    .map((c) => c?.transactionId)
    .filter((t): t is string => typeof t === 'string' && t.length > 0 && !seenTxns.has(t));
  if (shortfall.length > 0) {
    console.error('legacy_recovery_shortfall', {
      userId: user.id,
      claimedCredits: body?.snapshot?.localCredits ?? null,
      unmatchedTransactions: shortfall,
    });
  }

  const { data: stateRows } = await userClient.rpc('get_credit_state');
  const state = Array.isArray(stateRows) ? stateRows[0] : stateRows;

  return json({
    ok: true,
    // An orphaned purchase means somebody's credits are on another account, so
    // this device's story is not finished. Keep the evidence.
    definite: orphaned === 0,
    grantedFromRc,
    orphaned,
    shortfall,
    balance: state?.balance ?? null,
  });
});
