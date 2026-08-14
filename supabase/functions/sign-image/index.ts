import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Mint a signed URL for a guest's own uploaded image.
 *
 * WHY THIS EXISTS: the `images` bucket used to let the `anon` role (the key
 * baked into the app binary) list every folder and sign every object. That is
 * now closed - anon has INSERT-only and no read access at all. Guests have no
 * Supabase session, so they can no longer sign their own Vault thumbnails
 * client-side. This function does it for them, with the service role, for
 * their path only.
 *
 * Signed-in users do NOT need this: the per-user RLS policy lets them sign
 * anything under `<their uid>/` directly from the client.
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });

/**
 * Guest uploads live at anonymous/<uuid>/<uuid>.jpg. The random nested uuid IS
 * the access control here: there is no session to check ownership against, so
 * the only thing standing between a caller and someone else's guest photo is
 * that they cannot guess the path, and cannot list the bucket to find it.
 *
 * The legacy flat `anonymous/<ms-timestamp>.jpg` scheme is deliberately NOT
 * accepted. A 13-digit millisecond timestamp inside a known date range is
 * brute-forceable, which would make this endpoint an enumeration oracle over
 * ~1500 legacy guest photos. Those old thumbnails stay blank instead.
 */
const GUEST_IMAGE_PATH =
  /^anonymous\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

const EXPIRES_IN_SECONDS = 60 * 60;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({}, 200);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let path: string | undefined;
  try {
    const body = await req.json();
    path = typeof body.path === "string" ? body.path : undefined;
  } catch {
    return jsonResponse({ error: "Bad request JSON" }, 400);
  }

  if (!path) {
    return jsonResponse({ error: "path is required" }, 400);
  }

  if (path.includes("..") || path.startsWith("/") || !GUEST_IMAGE_PATH.test(path)) {
    console.warn("🚫 Rejected sign request for path:", path);
    return jsonResponse({ error: "Forbidden path" }, 403);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    ?? Deno.env.get('SERVICE_ROLE_KEY')
    ?? '';
  if (!serviceKey) {
    console.error("❌ Service role key not configured");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
  const { data, error } = await sb.storage
    .from('images')
    .createSignedUrl(path, EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) {
    console.error("❌ Signing failed:", error?.message);
    return jsonResponse({ error: "Could not sign image" }, 404);
  }

  return jsonResponse({ signedUrl: data.signedUrl });
});
