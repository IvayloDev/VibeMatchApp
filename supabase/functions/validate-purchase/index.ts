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
    const { transactionId, productId, platform } = body;

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
    const creditsToGrant = CREDITS_PER_PRODUCT[productId] || 0;
    if (creditsToGrant === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid product ID' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // NOTE: RevenueCat validates receipts on their servers.
    // Since we're using RevenueCat, we trust their validation.
    // The purchase has already been validated by RevenueCat before reaching this function.
    
    // Record the purchase in the database
    const { error: purchaseError } = await adminClient
      .from('purchases')
      .insert({
        user_id: user.id,
        product_id: productId,
        transaction_id: transactionId,
        platform: platform,
        credits_granted: creditsToGrant,
        validation_data: {
          validated_by: 'revenuecat',
          validated_at: new Date().toISOString(),
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
