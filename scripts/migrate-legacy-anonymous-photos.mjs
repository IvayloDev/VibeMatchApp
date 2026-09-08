#!/usr/bin/env node
/**
 * Phase 2, step 1 of the images-bucket lockdown: move every legacy photo that
 * belongs to a signed-in user out of the shared `anonymous/` prefix and into
 * that user's own folder, then repoint the history row at the new path.
 *
 * WHY THIS EXISTS
 *
 * 20260814000000_lock_down_images_storage_rls.sql closed the bucket to the
 * `anon` key but had to keep one temporary policy alive:
 *
 *   images: TEMP authenticated can read legacy anonymous prefix
 *     for select to authenticated
 *     using (bucket_id = 'images' and (storage.foldername(name))[1] = 'anonymous')
 *
 * There is no ownership test in it, because at the time there was no way to
 * tell whose photo was whose. So any signed-in user can read every legacy
 * photo. That policy cannot be dropped until the owned objects have moved,
 * because ~69% of Vault thumbnails point into that prefix and would go blank.
 *
 * It is also the thing standing between the project and anonymous auth: an
 * anonymous Supabase user carries the role `authenticated`, so enabling
 * anonymous sign-ins while this policy exists turns "any registered user can
 * read all legacy photos" into "anyone holding the app's anon key can".
 *
 * WHAT IT TOUCHES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Only objects named by a row in public.history that has a user_id. Those are
 * owned, and the owner is known. Everything else under `anonymous/` is left
 * exactly where it is:
 *
 *   - Guest matches never get a history row (the insert needs a user id), so a
 *     guest's photos are unowned from the server's point of view. They are
 *     still referenced by that guest's LOCAL vault (lib/guestHistory.ts), which
 *     survives signing in and is merged into the Vault by HistoryScreen. Moving
 *     or deleting one of those blanks a thumbnail on a device we cannot reach.
 *   - So deletion of true orphans is NOT part of this script. It is a separate,
 *     irreversible step that needs its own count, its own sample, and its own
 *     decision.
 *
 * The two sets are disjoint by construction: a path is either named by a
 * history row (owned) or held only in a device's local vault (guest), never
 * both, because the server insert and the local insert are the two arms of one
 * if/else in AnalyzingScreen.
 *
 * ORDER OF OPERATIONS, AND WHY
 *
 *   copy -> update the history row -> delete the source
 *
 * Not `move`. If the process dies between the rename and the database write,
 * a move leaves a row pointing at a path that no longer exists and the photo
 * is unreachable for good. With copy-first, dying anywhere leaves the row
 * pointing at an object that is still there, and re-running finishes the job.
 * Every step is idempotent: a destination that already exists is treated as a
 * completed copy, and a row that no longer starts with `anonymous/` is skipped.
 *
 * USAGE
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-legacy-anonymous-photos.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-legacy-anonymous-photos.mjs --apply
 *   ... --apply --limit 10        (do a cautious first batch)
 *
 * Dry run is the default and writes nothing. The service role key is required
 * because storage.objects is owned by supabase_storage_admin: the `postgres`
 * role the CLI and SQL editor connect as cannot touch it.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://mebjzwwtuzwcrwugxjvu.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Get it from Dashboard -> Project Settings -> API.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'images';

/** `anonymous/<uuid>/<uuid>.jpg` and `anonymous/<ms>.jpg` both end in the name. */
function destinationFor(userId, sourcePath) {
  const basename = sourcePath.split('/').pop();
  return `${userId}/${basename}`;
}

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (nothing is written) ===');

  const { data: rows, error } = await sb
    .from('history')
    .select('id, user_id, image_url, created_at')
    .like('image_url', 'anonymous/%')
    .not('user_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Could not read history:', error.message);
    process.exit(1);
  }

  const todo = rows.slice(0, LIMIT === Infinity ? rows.length : LIMIT);
  console.log(`${rows.length} owned legacy objects found; processing ${todo.length}.`);

  const tally = { moved: 0, alreadyThere: 0, missingSource: 0, failed: 0 };
  const failures = [];

  for (const [i, row] of todo.entries()) {
    const from = row.image_url;
    const to = destinationFor(row.user_id, from);
    const label = `[${i + 1}/${todo.length}] ${from} -> ${to}`;

    if (!APPLY) {
      console.log(`${label}  (dry run)`);
      continue;
    }

    try {
      // 1. Copy. A destination that already exists means a previous run got
      //    this far, which is a success, not a conflict.
      const { error: copyError } = await sb.storage.from(BUCKET).copy(from, to);
      let resumed = false;

      if (copyError) {
        const msg = (copyError.message || '').toLowerCase();
        if (msg.includes('exists') || msg.includes('duplicate')) {
          resumed = true;
        } else if (msg.includes('not found') || msg.includes('does not exist')) {
          // The row outlived its object. Leave the row alone rather than
          // repointing it at a path that holds nothing: a broken thumbnail
          // that still says where the photo was is easier to explain than one
          // that claims a new location and is equally empty.
          console.warn(`${label}  SOURCE MISSING, left as is`);
          tally.missingSource += 1;
          continue;
        } else {
          throw new Error(`copy failed: ${copyError.message}`);
        }
      }

      // 2. Repoint the row while both copies exist.
      const { error: updateError } = await sb
        .from('history')
        .update({ image_url: to })
        .eq('id', row.id);
      if (updateError) throw new Error(`history update failed: ${updateError.message}`);

      // 3. Only now drop the original. A failure here is untidy, not harmful:
      //    the row already points at the new object, and the leftover is
      //    swept up by the orphan pass.
      const { error: removeError } = await sb.storage.from(BUCKET).remove([from]);
      if (removeError) {
        console.warn(`${label}  moved, but the original could not be deleted: ${removeError.message}`);
      }

      if (resumed) tally.alreadyThere += 1;
      else tally.moved += 1;
      console.log(`${label}  ${resumed ? 'ok (resumed)' : 'ok'}`);
    } catch (err) {
      tally.failed += 1;
      failures.push({ id: row.id, from, to, error: String(err.message ?? err) });
      console.error(`${label}  FAILED: ${err.message ?? err}`);
    }
  }

  console.log('\n--- summary ---');
  console.log(tally);
  if (failures.length) {
    console.log('\nfailures:');
    for (const f of failures) console.log(` ${f.from}: ${f.error}`);
  }

  if (APPLY) {
    const { count } = await sb
      .from('history')
      .select('id', { count: 'exact', head: true })
      .like('image_url', 'anonymous/%')
      .not('user_id', 'is', null);
    console.log(`\nowned rows still pointing at anonymous/: ${count ?? 'unknown'}`);
    if (count === 0) {
      console.log('All owned objects have moved. The TEMP storage policy can now be dropped.');
    } else {
      console.log('Re-run to finish. The TEMP policy must stay until this reaches 0.');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
