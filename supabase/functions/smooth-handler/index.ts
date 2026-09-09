// Account deletion. The app calls this one (app/tabs/profile/ProfileScreen.tsx);
// `delete-user` is the retired duplicate.
//
// ORDER MATTERS HERE, AND IT USED TO BE WRONG
//
// The DB rows were deleted first and storage second. history.image_url is the
// ONLY record of where a person's photos live - a guest's uploads sit under
// `anonymous/<uuid>/<uuid>.jpg`, which belongs to no folder anyone can attribute
// to a user, and a photo taken before an anonymous identity was merged into this
// account still sits under the merged-away uid. Deleting the rows first threw
// those paths away, then listed one folder and called it done. So erasure left
// the actual photographs behind, which is the part of the account that matters
// most under GDPR Art.17.
//
// The order is now: read every path, remove the objects, then delete the rows.
//
// It also listed `<uid>/` with the default page size of 100, so anybody past
// their hundredth match kept every photo after that one. Both the folder listing
// and the history read are paginated.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

// Read once at cold start. The environment cannot change under a running
// isolate, and one place to look makes a missing secret obvious.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Addresses whose deletion must NOT burn the free grant: the owner's own test
// accounts, deleted and recreated constantly. This used to be a personal
// address hardcoded in this file. Comma-separated.
const EXEMPT_EMAILS = (Deno.env.get('DELETION_CREDIT_EXEMPT_EMAILS') ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const BUCKET = 'images';
// Supabase storage list() caps at 100 per page by default and silently returns
// only the first page. This is the page size, not the total.
const STORAGE_PAGE = 100;
// remove() takes an array; keep each request bounded so one very large account
// does not turn into a single enormous call that times out halfway through.
const STORAGE_REMOVE_BATCH = 100;
const HISTORY_PAGE = 1000;

// Rows that point at a user id. recommendation_log keeps what this account was
// served, so it goes too: erasure means nothing left that points at the account.
const USER_TABLES = [
  'user_profiles',
  'history',
  'spotify_taste_profiles',
  'spotify_connections',
  'recommendation_log',
];

/**
 * Every uid whose data belongs to this person: their current one, plus every
 * anonymous identity that was merged into it, following the chain.
 *
 * A guest's photos are filed under the uid they held at the time. Signing in
 * with Apple mints a NEW auth user and merge_anonymous_identity moves the rows
 * across, but the objects in storage keep their old paths and the old folder
 * keeps its name. identity_merges is the only surviving link between the two.
 */
async function mergedIdentities(admin: any, rootId: string): Promise<string[]> {
  const found = new Set<string>([rootId]);
  let frontier = [rootId];
  // A real chain is two or three deep (guest, guest again after a reinstall,
  // then the account). from_user is a primary key so a cycle cannot exist, but
  // the cap means a corrupt table cannot spin this forever.
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const { data, error } = await admin
      .from('identity_merges')
      .select('from_user')
      .in('to_user', frontier);
    if (error) {
      // Loud: what this misses is exactly the set of photos erasure exists to
      // remove, so it must not pass as a quiet nothing-to-do.
      console.error('Error reading identity_merges:', error.message);
      break;
    }
    const next: string[] = (data ?? [])
      .map((row: { from_user: string }) => row.from_user)
      .filter((id: string) => id && !found.has(id));
    next.forEach((id: string) => found.add(id));
    frontier = next;
  }
  return Array.from(found);
}

/**
 * An image_url as a bucket-relative object path.
 *
 * Rows hold the storage path (`<uid>/<ts>.jpg` or `anonymous/<uuid>/<uuid>.jpg`),
 * but a few legacy rows hold a full signed or public URL. Strip that down rather
 * than handing storage something it will silently decline to match.
 */
function toObjectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');
  try {
    const path = new URL(raw).pathname;
    const marker = `/${BUCKET}/`;
    const at = path.indexOf(marker);
    return at === -1 ? null : decodeURIComponent(path.slice(at + marker.length));
  } catch {
    return null;
  }
}

/** Every image path this person's history rows point at, across all their uids. */
async function historyImagePaths(admin: any, userIds: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (let from = 0; ; from += HISTORY_PAGE) {
    const { data, error } = await admin
      .from('history')
      .select('image_url')
      .in('user_id', userIds)
      .range(from, from + HISTORY_PAGE - 1);
    if (error) {
      console.error('Error reading history image paths:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const path = toObjectPath(row?.image_url);
      if (path) paths.push(path);
    }
    if (data.length < HISTORY_PAGE) break;
  }
  return paths;
}

/** Every object directly under one folder, following the pages to the end. */
async function listFolder(admin: any, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: STORAGE_PAGE, offset });
    if (error) {
      console.error(`Error listing storage folder ${prefix}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const entry of data) {
      // Storage returns nested folders as rows with no id. Only real objects
      // can be removed; a folder disappears once it is empty.
      if (entry?.id && entry?.name) paths.push(`${prefix}/${entry.name}`);
    }
    if (data.length < STORAGE_PAGE) break;
  }
  return paths;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Identify the calling user via their JWT
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: req.headers.get('Authorization') } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    console.log('Deleting user:', user.id);

    // ── 0. Record email so free credits can't be claimed again after re-signup ─
    //
    // NOTE FOR THE PRIVACY POLICY: this keeps the address after the account is
    // gone, so a delete-and-resignup loop cannot farm the free grant. The policy
    // currently says deletion is permanent, which this contradicts. The
    // behaviour is deliberate; the wording is what needs to change.
    const email = user.email?.trim().toLowerCase() ?? '';
    if (email && !EXEMPT_EMAILS.includes(email)) {
      const { error: creditedError } = await adminClient
        .from('credited_emails')
        .upsert({ email: user.email }, { onConflict: 'email' });
      if (creditedError) console.error('Error recording credited email:', creditedError.message);
      else console.log('Recorded credited email');
    }

    // ── 1. Work out which uids this person's data is filed under ─────────────
    const userIds = await mergedIdentities(adminClient, user.id);
    if (userIds.length > 1) {
      console.log(`Account covers ${userIds.length} identities (merged guests included)`);
    }

    // ── 2. Collect every photo path BEFORE anything is deleted ───────────────
    // history.image_url is the only way to reach a guest upload under
    // `anonymous/...`, and it is about to be deleted along with the rows.
    const paths = new Set<string>();
    for (const path of await historyImagePaths(adminClient, userIds)) {
      paths.add(path);
    }
    // Folder listings catch anything the history rows missed: a scan that failed
    // before its row was written, or a row deleted from the Vault while the
    // object stayed behind.
    for (const id of userIds) {
      for (const path of await listFolder(adminClient, id)) paths.add(path);
    }

    // ── 3. Remove the objects ────────────────────────────────────────────────
    const allPaths = Array.from(paths);
    let removed = 0;
    for (let i = 0; i < allPaths.length; i += STORAGE_REMOVE_BATCH) {
      const batch = allPaths.slice(i, i + STORAGE_REMOVE_BATCH);
      const { error: removeError } = await adminClient.storage.from(BUCKET).remove(batch);
      if (removeError) console.error('Error removing storage files:', removeError.message);
      else removed += batch.length;
    }
    console.log(`Deleted ${removed} of ${allPaths.length} storage object(s)`);

    // ── 4. Delete the DB rows, now that the paths have been used ─────────────
    for (const table of USER_TABLES) {
      const { error } = await adminClient.from(table).delete().in('user_id', userIds);
      if (error) console.error(`Error deleting from ${table}:`, error.message);
      else console.log(`Deleted from ${table}`);
    }

    // ── 5. Hard-delete the auth user ─────────────────────────────────────────
    //
    // Only this one. The merged-away anonymous users stay: identity_merges
    // cascades on from_user, so deleting them would drop the row that records
    // the merge as already done, and merge_anonymous_identity treats a missing
    // row as "not merged yet". Their data is gone either way, and the abandoned
    // anonymous prune sweeps the shells up separately.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('Error deleting auth user:', deleteError.message);
      return json({ error: 'Failed to delete user account' }, 500);
    }

    console.log('User fully deleted:', user.id);

    return json({ success: true }, 200);

  } catch (error) {
    // The detail stays in the log. It used to be returned, and it names our
    // tables, our constraints and our storage layout to anyone who can make
    // this function throw.
    console.error('Function error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
