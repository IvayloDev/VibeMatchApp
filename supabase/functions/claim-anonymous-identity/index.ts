/**
 * Move an anonymous identity's balance, purchases and Vault onto the account
 * it just became.
 *
 * Called right after a native Apple or Google sign-in, which mints a NEW
 * auth.users row and replaces the session. Without this, the anonymous user
 * holding everything is simply abandoned: the client-side merge was deleted
 * when credits moved server-side, and claim_device_starter will not re-grant
 * because the DEVICE has already claimed. A guest who bought a pack and then
 * signed in with Apple lost the pack.
 *
 * AUTHORISATION, WHICH IS THE WHOLE DESIGN
 *
 * Both sides must be proven, not asserted:
 *   - the DESTINATION is whoever holds the Authorization header. The caller
 *     cannot merge into somebody else's account because they cannot present
 *     that person's JWT.
 *   - the SOURCE is proven by presenting its access token in the body, which
 *     is verified the same way. A uid alone would let anyone name any user.
 *
 * The database refuses anything but an anonymous source, so even a valid pair
 * of tokens cannot be used to drain a real account, and identity_merges makes
 * a replay a no-op rather than a second payout.
 *
 * POST { anonymousAccessToken } with the NEW session's JWT
 *   -> 200 { merged, creditsMoved, balance }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/products.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Who this is becoming.
  const newClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user: newUser }, error: newError } = await newClient.auth.getUser();
  if (newError || !newUser) return json({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const oldToken = typeof body?.anonymousAccessToken === 'string' ? body.anonymousAccessToken : '';
  if (!oldToken) return json({ error: 'Missing anonymousAccessToken' }, 400);

  // Who they were. Proven by the token, never taken on the client's word.
  const oldClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${oldToken}` } },
  });
  const { data: { user: oldUser }, error: oldError } = await oldClient.auth.getUser();
  if (oldError || !oldUser) {
    // An expired anonymous token is the common case here, not an attack: the
    // sign-in may have taken longer than the token had left. Retryable is
    // wrong (the token will not get younger), so say so plainly and let the
    // client stop.
    console.warn('claim-anonymous-identity: the anonymous token did not verify', oldError?.message);
    return json({ error: 'Could not verify the previous identity', merged: false }, 403);
  }

  if (oldUser.id === newUser.id) {
    // Email signup upgrades in place, so this is normal, not an error.
    return json({ merged: false, reason: 'same identity', balance: null }, 200);
  }
  if (!(oldUser as any).is_anonymous) {
    console.error('claim-anonymous-identity: refused, source is a registered account', {
      from: oldUser.id, to: newUser.id,
    });
    return json({ error: 'Refusing to consume a registered account' }, 403);
  }

  const admin = createClient(
    url,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  );

  const { data, error } = await admin.rpc('merge_anonymous_identity', {
    p_old: oldUser.id,
    p_new: newUser.id,
  });
  if (error) {
    console.error('merge_anonymous_identity failed:', error.message);
    return json({ error: 'Merge failed', retryable: true }, 503);
  }

  const row = Array.isArray(data) ? data[0] : data;
  console.log(row?.merged ? '✅ identity merged' : 'ℹ️ identity already merged', {
    from: oldUser.id, to: newUser.id, credits: row?.credits_moved,
  });

  return json({
    merged: !!row?.merged,
    creditsMoved: row?.credits_moved ?? 0,
    balance: row?.balance ?? null,
  });
});
