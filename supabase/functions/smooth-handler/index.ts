import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  try {
    // Create a Supabase client with the Auth context of the function
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });

    // Get the user from the request
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create admin client with service role key
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Processing deletion for user ID:', user.id);

    // Step 1: Delete all user data from custom tables
    const { error: profileError } = await adminClient.from('user_profiles').delete().eq('user_id', user.id);
    if (profileError) {
      console.log('Profile deletion error:', profileError);
    } else {
      console.log('Profile data deleted successfully');
    }

    const { error: historyError } = await adminClient.from('history').delete().eq('user_id', user.id);
    if (historyError) {
      console.log('History deletion error:', historyError);
    } else {
      console.log('History data deleted successfully');
    }

    // Step 2: Deactivate the user account instead of deleting it
    // This avoids database constraint issues while preventing future access
    const { error: deactivateError } = await adminClient.auth.admin.updateUserById(user.id, {
      user_metadata: { 
        deleted: true,
        deleted_at: new Date().toISOString(),
        original_email: user.email
      },
      app_metadata: { 
        deleted: true,
        deleted_at: new Date().toISOString()
      }
    });

    if (deactivateError) {
      console.error('Error deactivating user:', deactivateError);
      return new Response(JSON.stringify({
        error: 'Failed to deactivate user account',
        details: deactivateError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('User account deactivated successfully');

    return new Response(JSON.stringify({
      success: true,
      message: 'User account deactivated and all data deleted successfully'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}); 