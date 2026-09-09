// Spotify OAuth helper edge function.
// Two actions:
//   { action: "exchange", code, code_verifier, redirect_uri } -> exchanges PKCE auth code
//   { action: "refresh",  refresh_token }                     -> refreshes access token
//
// For registered users (Authorization header present), "exchange" persists tokens into
// spotify_connections and returns { access_token, expires_in, scope, spotify_user_id }.
// For guest users, tokens are returned in the response body so the client can store them
// in expo-secure-store.
//
// If Spotify answers 403 to /me right after the exchange (the app is in Development mode
// and the account is not on its allowlist), "exchange" responds 403
// { error: "spotify_not_allowlisted", code: "spotify_not_allowlisted" } and persists nothing.
//
// WHY "refresh" NEEDS A JWT AND "exchange" DOES NOT
//
// A Spotify refresh token issued to a confidential client is inert on its own:
// redeeming it needs the client secret. This function holds that secret, so an
// unauthenticated "refresh" turned a leaked refresh token into a live access
// token for anybody who sent it - the endpoint supplied the one thing the
// attacker was missing. Every install now holds an identity (anonymous ones
// included), so requiring a user token here costs nothing that ships and takes
// the endpoint off the open internet. It is not proof of ownership - the server
// has no record of which device holds which guest refresh token - so the path
// is metered per address as well, hard, because an anonymous identity is free
// to mint.
//
// "exchange" stays open: its credential is a single-use authorization code
// bound to a PKCE verifier the caller must already have generated, so it cannot
// be replayed or pointed at somebody else's account.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_ME_URL = "https://api.spotify.com/v1/me";

// Per-address ceiling on "refresh", counted over the last hour in
// edge_call_log. No shipped client calls this action at all (lib/spotify.ts
// only ever sends "exchange"; sync-spotify-profile refreshes server-side), so
// the ceiling is set at what a debugging session would need rather than at
// what a user session costs.
const REFRESH_CALLS_PER_IP_PER_HOUR = 30;

/**
 * The caller's address, preferring a hop the caller cannot write.
 *
 * The leftmost x-forwarded-for entry is client-supplied, so metering on it
 * lets an attacker reset their own counter every request. cf-connecting-ip and
 * x-real-ip are written by the edge in front of this function; the rightmost
 * forwarded hop is the fallback because it is the one the nearest proxy added.
 */
function callerIp(req: Request): string | null {
  const direct = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "").trim();
  if (direct) return direct;
  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

/**
 * Count and record one refresh. Returns true when the caller must be refused.
 *
 * Fails CLOSED on every uncertainty - no address, unreadable ledger, thrown
 * client - because nothing a user does reaches this action. Refusing it when
 * the meter is blind costs a real person nothing and denies an attacker the
 * one move that turns a stolen refresh token into a working one.
 */
async function overRefreshLimit(sb: any, ip: string | null): Promise<boolean> {
  if (!ip) {
    console.warn("🚫 refresh with no caller address, refusing");
    return true;
  }
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await sb
      .from("edge_call_log")
      .select("id", { count: "exact", head: true })
      .eq("fn", "spotify-auth")
      .eq("mode", "refresh")
      .eq("ip", ip)
      .gt("created_at", since);
    if (error) {
      console.warn("🚫 refresh count failed, refusing:", error.message);
      return true;
    }
    if ((count ?? 0) >= REFRESH_CALLS_PER_IP_PER_HOUR) {
      console.warn(`🚫 refresh ceiling hit for ip=${ip} count=${count}`);
      return true;
    }
    const { error: insertError } = await sb
      .from("edge_call_log")
      .insert({ fn: "spotify-auth", mode: "refresh", ip });
    if (insertError) console.warn("edge_call_log insert failed:", insertError.message);
    return false;
  } catch (err) {
    console.warn("🚫 refresh meter threw, refusing:", err);
    return true;
  }
}

function basicAuthHeader(): string {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
  return "Basic " + btoa(`${clientId}:${clientSecret}`);
}

async function exchangeCode(code: string, codeVerifier: string, redirectUri: string) {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) {
    // Spotify's error_description names our client id, our redirect uri and
    // which half of the PKCE pair it disliked. That belongs in the log, not in
    // a response body the app renders straight into an alert.
    console.error("❌ Spotify code exchange failed:", resp.status, data);
    throw new Error("Spotify code exchange failed");
  }
  return data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
}

async function refreshToken(refreshTokenValue: string) {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
    client_id: clientId,
  });

  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) {
    // Same reasoning as the exchange: Spotify's wording tells the caller
    // whether the token was merely expired or never valid, which is exactly
    // the oracle an attacker probing stolen tokens wants.
    console.error("❌ Spotify token refresh failed:", resp.status, data);
    throw new Error("Spotify token refresh failed");
  }
  return data as {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    refresh_token?: string;
  };
}

type SpotifyProfile = { id: string; display_name?: string };

// Returns the HTTP status alongside the profile so the exchange action can tell
// "Spotify refuses this account" apart from a transient failure. While the app
// is in Development mode, OAuth succeeds for any account but every Web API call
// answers 403 unless the account is on the app's allowlist.
async function fetchSpotifyProfile(
  accessToken: string,
): Promise<{ status: number; profile: SpotifyProfile | null }> {
  const resp = await fetch(SPOTIFY_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    console.warn(`⚠️ Spotify /me -> ${resp.status}`);
    return { status: resp.status, profile: null };
  }
  return { status: resp.status, profile: await resp.json() as SpotifyProfile };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request JSON" }, 400);
  }

  const action = body.action;

  // Identify user (if any) from Authorization header
  let userId: string | undefined;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await sb.auth.getUser();
      if (user) userId = user.id;
    } catch (err) {
      console.warn("⚠️ Could not resolve user:", err);
    }
  }

  try {
    if (action === "exchange") {
      const { code, code_verifier, redirect_uri } = body;
      if (!code || !code_verifier || !redirect_uri) {
        return json({ error: "Missing code, code_verifier, or redirect_uri" }, 400);
      }

      const tokens = await exchangeCode(code, code_verifier, redirect_uri);
      const me = await fetchSpotifyProfile(tokens.access_token);

      // 403 straight after a successful token exchange means the Spotify app is
      // in Development mode and this account is not on its allowlist. Every
      // later Web API call would answer 403 as well, so refuse the connection
      // now instead of saving tokens that can never load listening data: no
      // spotify_connections row for registered users, no tokens for guests.
      if (me.status === 403) {
        console.warn("⚠️ Spotify /me -> 403: account not on the app allowlist, connection not saved");
        return json({ error: "spotify_not_allowlisted", code: "spotify_not_allowlisted" }, 403);
      }
      // Any other non-OK status (5xx, rate limit) is treated as transient, as
      // before: the connection is saved without a profile. The helper has
      // already logged the status.
      const profile = me.profile;
      const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString();

      if (userId) {
        // Registered user: persist server-side
        const admin = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );
        const { error } = await admin.from("spotify_connections").upsert({
          user_id: userId,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expires_at: expiresAt,
          scope: tokens.scope,
          spotify_user_id: profile?.id ?? null,
          display_name: profile?.display_name ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        if (error) {
          console.error("❌ Failed to upsert spotify_connection:", error);
          return json({ error: "Failed to save connection" }, 500);
        }

        return json({
          success: true,
          stored: "server",
          spotify_user_id: profile?.id ?? null,
          display_name: profile?.display_name ?? null,
          scope: tokens.scope,
        });
      }

      // Guest: return tokens to client (client stores in SecureStore)
      return json({
        success: true,
        stored: "client",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        expires_at: expiresAt,
        scope: tokens.scope,
        spotify_user_id: profile?.id ?? null,
        display_name: profile?.display_name ?? null,
      });
    }

    if (action === "refresh") {
      // Identity first, before the refresh token is even looked at: without
      // this the endpoint redeemed anyone's leaked token with the app's own
      // client secret and handed back a live access token. See the note at the
      // top of this file for why "exchange" does not need the same gate.
      if (!userId) {
        console.warn("🚫 refresh refused: no user token on the request");
        return json({ error: "Sign in to refresh a Spotify connection" }, 401);
      }

      // One admin client for the whole action: the meter counts with it and the
      // connection update writes with it.
      const admin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      if (await overRefreshLimit(admin, callerIp(req))) {
        return json({ error: "Too many refresh requests", code: "rate_limited" }, 429);
      }

      const { refresh_token: rt } = body;
      if (!rt) return json({ error: "Missing refresh_token" }, 400);

      const tokens = await refreshToken(rt);
      const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString();
      const newRefresh = tokens.refresh_token ?? rt;

      await admin.from("spotify_connections").update({
        access_token: tokens.access_token,
        refresh_token: newRefresh,
        expires_at: expiresAt,
        scope: tokens.scope,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);

      return json({
        success: true,
        access_token: tokens.access_token,
        refresh_token: newRefresh,
        expires_in: tokens.expires_in,
        expires_at: expiresAt,
        scope: tokens.scope,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    // Whatever threw, the caller gets one flat sentence. err.message here is
    // ours: a Spotify token-endpoint complaint, a PostgREST message naming
    // spotify_connections and its constraints, or a missing-credential notice.
    console.error("❌ spotify-auth error:", err);
    return json({ error: "Spotify sign-in is unavailable right now" }, 500);
  }
});
