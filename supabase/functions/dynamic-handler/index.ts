/**
 * TOMBSTONE. This endpoint is retired and refuses every request.
 *
 * What it used to be: a copy of validate-purchase from before receipt
 * verification existed. It authenticated the caller and then granted the
 * credits for whatever product id the request named, using the service role,
 * with a comment where the check should be that said we trust RevenueCat's
 * validation while never asking RevenueCat anything. A fresh uuid as the
 * transaction id defeated the only guard it had, the duplicate check, so it
 * minted 150 credits per call for anyone with an account. Signups are open, so
 * an account costs nothing.
 *
 * It had no source in this repo and nothing in the app called it, which is how
 * it outlived the hardening of validate-purchase: that fix closed one URL while
 * this one kept the same door open. The previous body is in git history at the
 * commit that added this file, if it is ever needed for reference.
 *
 * Left deployed as a refusal rather than simply deleted so that anything still
 * pointing here gets an honest answer instead of a 404 that reads like a
 * network problem. Safe to delete outright once the logs are quiet:
 *
 *     npx supabase functions delete dynamic-handler
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // Log enough to tell a forgotten client apart from someone probing.
  console.warn('dynamic-handler is retired; refused a request', {
    ip: (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    hasAuth: !!req.headers.get('Authorization'),
  });
  return new Response(
    JSON.stringify({ success: false, error: 'This endpoint has been retired.' }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
