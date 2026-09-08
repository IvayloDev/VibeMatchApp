/**
 * TOMBSTONE. This endpoint is retired and refuses every request.
 *
 * Account deletion lives in `smooth-handler`, which is what the app actually
 * calls (ProfileScreen -> "Delete Profile"). That one holds the service role,
 * erases the user's rows and their storage folder, records the email so the
 * free grant cannot be claimed again, and hard-deletes the auth user.
 *
 * This one was a broken duplicate. It built its client from the ANON key plus
 * the caller's JWT, so `auth.admin.deleteUser` could never succeed: that call
 * needs the service role. What it did instead was delete the caller's
 * user_profiles and history rows under their own RLS, then fail at the last
 * step, leaving a live account with its credits and history destroyed and no
 * way to tell that had happened. Nothing in the app referenced it, but it was
 * deployed and reachable by anyone signed in.
 *
 * Previous body is in git history. Safe to delete outright once the logs are
 * quiet:
 *
 *     npx supabase functions delete delete-user
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
  console.warn('delete-user is retired; refused a request. Account deletion is smooth-handler.', {
    ip: (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    hasAuth: !!req.headers.get('Authorization'),
  });
  return new Response(
    JSON.stringify({
      success: false,
      error: 'This endpoint has been retired. Account deletion is handled elsewhere in the app.',
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
