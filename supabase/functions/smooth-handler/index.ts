import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Identify the calling user via their JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Deleting user:', user.id);

    // ── 0. Record email so free credits can't be claimed again after re-signup ─
    const WHITELISTED_EMAILS = ['ivodevpalchev@gmail.com'];
    if (user.email && !WHITELISTED_EMAILS.includes(user.email)) {
      const { error: creditedError } = await adminClient
        .from('credited_emails')
        .upsert({ email: user.email }, { onConflict: 'email' });
      if (creditedError) console.error('Error recording credited email:', creditedError.message);
      else console.log('Recorded credited email:', user.email);
    }

    // ── 1. Delete all DB rows ────────────────────────────────────────────────
    const tables = ['user_profiles', 'history', 'spotify_taste_profiles', 'spotify_connections'];
    for (const table of tables) {
      const { error } = await adminClient.from(table).delete().eq('user_id', user.id);
      if (error) console.error(`Error deleting from ${table}:`, error.message);
      else console.log(`Deleted from ${table}`);
    }

    // ── 2. Delete storage images ─────────────────────────────────────────────
    const { data: files, error: listError } = await adminClient.storage
      .from('images')
      .list(user.id);

    if (listError) {
      console.error('Error listing storage files:', listError.message);
    } else if (files && files.length > 0) {
      const paths = files.map((f: { name: string }) => `${user.id}/${f.name}`);
      const { error: removeError } = await adminClient.storage.from('images').remove(paths);
      if (removeError) console.error('Error removing storage files:', removeError.message);
      else console.log(`Deleted ${paths.length} storage file(s)`);
    }

    // ── 3. Hard-delete the auth user ─────────────────────────────────────────
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('Error deleting auth user:', deleteError.message);
      return new Response(JSON.stringify({ error: 'Failed to delete user account', details: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('User fully deleted:', user.id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
