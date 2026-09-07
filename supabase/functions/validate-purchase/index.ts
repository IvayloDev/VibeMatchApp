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
async function verifyWithRevenueCat(
  secret: string,
  appUserId: string,
  productId: string,
  transactionId: string,
): Promise<string | null> {
  const resp = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    console.error('RevenueCat lookup failed:', resp.status);
    return null;
  }
  const json = await resp.json();
  const purchases: Array<{ id?: string; store_transaction_id?: string; purchase_date?: string }> =
    json?.subscriber?.non_subscriptions?.[productId] ?? [];
  if (purchases.length === 0) return null;

  const exact = purchases.find((p) => p.id === transactionId || p.store_transaction_id === transactionId);
  if (exact?.id) return exact.id;

  if (transactionId.startsWith('rc_')) {
    const cutoff = Date.now() - 15 * 60 * 1000;
    const recent = purchases
      .filter((p) => p.id && p.purchase_date && Date.parse(p.purchase_date) >= cutoff)
      .sort((a, b) => Date.parse(b.purchase_date!) - Date.parse(a.purchase_date!));
    if (recent[0]?.id) return recent[0].id;
  }
  return null;
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
      return new Response(
        JSON.stringify({
          success: true,
          alreadyProcessed: true,
          creditsGranted: existingPurchase.credits_granted,
          newBalance: existingPurchase.credits_granted, // Return the credits that were already granted
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

    // Launch offer bonus credits (client-requested, capped server-side)
    // Only accepted for known product ids (enforced by the baseCredits check above)
    const requestedBonus = Number(bonus) || 0;
    const bonusCredits = Math.min(Math.max(0, Math.floor(requestedBonus)), 30);
    const creditsToGrant = baseCredits + bonusCredits;

    // RevenueCat validates the store receipt, but nothing here used to check
    // that RevenueCat had actually seen this transaction: any signed-in user
    // could post a made-up transaction id and the largest product id and be
    // granted its credits. When REVENUECAT_SECRET_API_KEY is set, the purchase
    // has to exist on the subscriber that RevenueCat holds for this user id.
    // Without the secret the old trusting path runs, loudly, so a missing
    // secret never blocks a real purchase.
    const rcSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
    let verifiedTransactionId = transactionId;
    if (rcSecret) {
      const verified = await verifyWithRevenueCat(rcSecret, user.id, productId, transactionId);
      if (!verified) {
        console.warn('🚫 RevenueCat has no such purchase', { userId: user.id, productId, transactionId });
        return new Response(
          JSON.stringify({ success: false, error: 'Purchase not found' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      verifiedTransactionId = verified;
      // The client may have sent a synthetic id; dedupe on the real one.
      if (verifiedTransactionId !== transactionId) {
        const { data: dup } = await adminClient
          .from('purchases')
          .select('credits_granted')
          .eq('transaction_id', verifiedTransactionId)
          .maybeSingle();
        if (dup) {
          return new Response(
            JSON.stringify({ success: true, alreadyProcessed: true, creditsGranted: dup.credits_granted, newBalance: dup.credits_granted }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      console.warn('⚠️ REVENUECAT_SECRET_API_KEY not set: granting on the client\'s word');
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
          validated_by: rcSecret ? 'revenuecat_api' : 'client',
          validated_at: new Date().toISOString(),
          base_credits: baseCredits,
          launch_offer_bonus: bonusCredits,
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
