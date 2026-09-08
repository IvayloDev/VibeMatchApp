import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Credits per product ID - must match lib/revenuecat.ts
const CREDITS_PER_PRODUCT: Record<string, number> = {
  'tunematch_credits_5': 5,
  'tunematch_credits_18': 18,
  'tunematch_credits_60': 60,
  'tunematch_credits_150': 150,
};

/**
 * Look the purchase up on RevenueCat's own record of this subscriber.
 *
 * Returns RevenueCat's transaction id for the purchase, or null when the
 * subscriber has no such purchase. Accepts either RevenueCat's id or the
 * store's, and, for the client's synthetic fallback ids, any purchase of the
 * product made in the last fifteen minutes.
 */
type RcVerdict =
  /** RevenueCat holds this purchase. Carries its own transaction id. */
  | { status: 'verified'; transactionId: string }
  /** RevenueCat answered and has no such purchase for this user. */
  | { status: 'not_found' }
  /**
   * We could not ask. A bad or rotated key, a RevenueCat outage, a rate limit,
   * a network failure. Never treated as fraud AND never treated as proof: the
   * caller is told to come back, which is what the client's pending-validation
   * queue already does. Granting here instead was a credit-minting hole, since
   * an attacker can induce it just by exhausting our RevenueCat rate limit.
   */
  | { status: 'unavailable'; detail: string };

async function verifyWithRevenueCat(
  secret: string,
  appUserId: string,
  productId: string,
  transactionId: string,
): Promise<RcVerdict> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return { status: 'unavailable', detail: `network: ${err}` };
  }
  // 401/403 is our credential, 5xx and 429 are their availability. None of
  // them are a statement about this purchase.
  if (resp.status === 401 || resp.status === 403 || resp.status === 429 || resp.status >= 500) {
    return { status: 'unavailable', detail: `http ${resp.status}` };
  }
  if (!resp.ok) {
    // A 404 here means RevenueCat has no subscriber record for this app user
    // id at all, which for a purchase we were just told about is a real miss.
    console.error('RevenueCat lookup failed:', resp.status);
    return { status: 'not_found' };
  }
  const json = await resp.json();
  const purchases: Array<{ id?: string; store_transaction_id?: string; purchase_date?: string }> =
    json?.subscriber?.non_subscriptions?.[productId] ?? [];
  if (purchases.length === 0) return { status: 'not_found' };

  const exact = purchases.find((p) => p.id === transactionId || p.store_transaction_id === transactionId);
  if (exact?.id) return { status: 'verified', transactionId: exact.id };

  if (transactionId.startsWith('rc_')) {
    const cutoff = Date.now() - 15 * 60 * 1000;
    const recent = purchases
      .filter((p) => p.id && p.purchase_date && Date.parse(p.purchase_date) >= cutoff)
      .sort((a, b) => Date.parse(b.purchase_date!) - Date.parse(a.purchase_date!));
    if (recent[0]?.id) return { status: 'verified', transactionId: recent[0].id };
  }
  return { status: 'not_found' };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create a Supabase client with the Auth context
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: {
            Authorization: req.headers.get('Authorization') ?? '',
          },
        },
      }
    );

    // Get the user from the request
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const body = await req.json();
    const { transactionId, productId, platform, bonus } = body;

    if (!transactionId || !productId || !platform) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: transactionId, productId, platform' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create admin client for database operations
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if this transaction has already been processed (prevent duplicate grants)
    const { data: existingPurchase } = await adminClient
      .from('purchases')
      .select('*')
      .eq('transaction_id', transactionId)
      .single();

    if (existingPurchase) {
      console.log('Transaction already processed:', transactionId);
      // Return success but don't grant credits again
      // newBalance used to echo credits_granted, which is a grant AMOUNT and
      // not a balance, and the purchase screens display it as the user's new
      // balance. Read the real one.
      const { data: existingProfile } = await adminClient
        .from('user_profiles')
        .select('credits')
        .eq('user_id', user.id)
        .maybeSingle();
      return new Response(
        JSON.stringify({
          success: true,
          alreadyProcessed: true,
          creditsGranted: existingPurchase.credits_granted,
          newBalance: existingProfile?.credits ?? null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get credits for this product
    const baseCredits = CREDITS_PER_PRODUCT[productId] || 0;
    if (baseCredits === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid product ID' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // The launch-offer bonus used to be a number in the request body, clamped
    // to 0..30 and added to any product. No shipped client has ever sent a
    // nonzero value (both call sites in lib/supabase.ts default it to 0), so
    // every nonzero bonus that arrives here is forged: the 5-credit pack at
    // $0.99 plus bonus:30 is 35 credits, 2.8 cents a match against an intended
    // 19.8. RevenueCat verification cannot help, because it confirms that the
    // purchase happened, never what bonus it earned. If the offer comes back it
    // belongs in CREDITS_PER_PRODUCT or on a server-side flag, not in the body.
    if (bonus !== undefined && Number(bonus) > 0) {
      console.warn('🚫 Ignoring client-supplied bonus credits', { userId: user.id, productId, bonus });
    }
    const creditsToGrant = baseCredits;

    // A grant only ever follows a purchase RevenueCat confirms.
    //
    // The rule here used to be "grant when we cannot verify", reasoning that a
    // customer the store has already charged must never be refused. That is
    // right about the customer and wrong about the mechanism. It meant:
    //   - with no secret set, ANY signed-in caller posting a fresh uuid and
    //     the largest product id was granted 150 credits, repeatably;
    //   - with the secret set, the same held whenever RevenueCat answered 429,
    //     which an attacker induces simply by making this endpoint call it.
    // The grant runs on the service role, so the user_profiles credits guard
    // does not (and should not) stand in its way. Verification is the only
    // thing between a forged body and a balance.
    //
    // Refusing costs a real customer nothing, because the client already
    // queues an unconfirmed purchase (storePendingValidation) and retries it
    // from the Pro screen, having told the user their credits arrive shortly.
    // So an outage delays a genuine buyer and permanently refuses a forged
    // one. 503, not 403, so the queue keeps retrying rather than giving up.
    const rcSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
    const unverifiable = (detail: string) => {
      console.error('⚠️ Cannot verify purchase, refusing to grant:', detail, {
        userId: user.id,
        productId,
        transactionId,
      });
      return new Response(
        JSON.stringify({
          success: false,
          retryable: true,
          error: 'Could not verify this purchase yet. It will be granted automatically once we can.',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    };

    if (!rcSecret) {
      // Deliberately fatal rather than trusting: an unset key is an operator
      // error, and the whole point of this endpoint is that it does not take
      // the client's word for money.
      return unverifiable('REVENUECAT_SECRET_API_KEY is not set');
    }

    let verdict = await verifyWithRevenueCat(rcSecret, user.id, productId, transactionId);
    // One retry before believing a miss. The client calls this the moment the
    // RevenueCat SDK resolves the purchase, which can be marginally ahead of
    // RevenueCat's own servers having recorded it.
    if (verdict.status === 'not_found') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      verdict = await verifyWithRevenueCat(rcSecret, user.id, productId, transactionId);
    }
    if (verdict.status === 'unavailable') {
      return unverifiable(verdict.detail);
    }
    if (verdict.status === 'not_found') {
      console.warn('🚫 RevenueCat has no such purchase', { userId: user.id, productId, transactionId });
      return new Response(
        JSON.stringify({ success: false, error: 'Purchase not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // From here the id is RevenueCat's own, never the client's string. That is
    // what makes the dedupe real: a forged id can no longer reserve a row,
    // and a replay of the same genuine purchase collides on the id RevenueCat
    // assigned it however the client chose to name it.
    const verifiedTransactionId = verdict.transactionId;
    if (verifiedTransactionId !== transactionId) {
      const { data: dup } = await adminClient
        .from('purchases')
        .select('credits_granted')
        .eq('transaction_id', verifiedTransactionId)
        .maybeSingle();
      if (dup) {
        const { data: dupProfile } = await adminClient
          .from('user_profiles')
          .select('credits')
          .eq('user_id', user.id)
          .maybeSingle();
        return new Response(
          JSON.stringify({
            success: true,
            alreadyProcessed: true,
            creditsGranted: dup.credits_granted,
            newBalance: dupProfile?.credits ?? null,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Record the purchase in the database
    const { error: purchaseError } = await adminClient
      .from('purchases')
      .insert({
        user_id: user.id,
        product_id: productId,
        transaction_id: verifiedTransactionId,
        platform: platform,
        credits_granted: creditsToGrant,
        validation_data: {
          validated_by: 'revenuecat_api',
          validated_at: new Date().toISOString(),
          base_credits: baseCredits,
          launch_offer_bonus: 0,
        },
      });

    if (purchaseError) {
      console.error('Error recording purchase:', purchaseError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to record purchase' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get current user credits
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single();

    const currentCredits = profile?.credits || 0;
    const newCredits = currentCredits + creditsToGrant;

    // Update user credits
    const { error: updateError } = await adminClient
      .from('user_profiles')
      .upsert({
        user_id: user.id,
        credits: newCredits,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (updateError) {
      console.error('Error updating credits:', updateError);
      // Take the dedup row back out. The purchase row is inserted BEFORE the
      // grant, so leaving it behind makes every retry return alreadyProcessed at
      // the top of this function, and the client deletes its pending-validation
      // record on that reply. A customer who was charged would be permanently
      // locked out of the credits they paid for.
      const { error: rollbackError } = await adminClient
        .from('purchases')
        .delete()
        .eq('transaction_id', verifiedTransactionId);
      if (rollbackError) {
        console.error(
          '🚨 Could not roll back the purchase row, this transaction is now stuck:',
          rollbackError.message,
          { transactionId: verifiedTransactionId, userId: user.id }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to grant credits' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`✅ Purchase validated and credits granted: ${creditsToGrant} credits to user ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        creditsGranted: creditsToGrant,
        newBalance: newCredits,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'Internal server error', 
        details: error?.message || 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
