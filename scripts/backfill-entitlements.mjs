#!/usr/bin/env node
/**
 * Populate public.entitlements from RevenueCat for everyone who already
 * subscribed.
 *
 * WHY THIS IS NEEDED
 *
 * public.entitlements is written by exactly one thing: the RevenueCat webhook,
 * on renewal-class events. Those only fire from now on. So on the day the new
 * client ships, every EXISTING subscriber reads as not-Pro inside charge_scan,
 * and the server either spends their credit packs on matches their
 * subscription already covers, or hard-refuses with 402 and shows a credit
 * paywall to somebody paying monthly. Both are worse than the problem the
 * ledger was built to fix.
 *
 * A subscription leaves no row in public.purchases (that table is credit
 * packs), so there is no local way to know who is a subscriber. RevenueCat is
 * the only source of truth, and it has to be asked per user.
 *
 * WHAT IT WRITES
 *
 * Only users who actually have the 'pro' entitlement recorded, active or
 * expired. Everyone else is skipped rather than given an 'expired' row, so the
 * table keeps meaning "someone we know something about" instead of filling
 * with negative facts about people who never subscribed.
 *
 * Idempotent: apply_entitlement upserts on user_id, so re-running converges.
 *
 * USAGE
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... REVENUECAT_SECRET_API_KEY=... \
 *     node scripts/backfill-entitlements.mjs
 *   ... --apply          actually write
 *   ... --apply --limit 50
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://mebjzwwtuzwcrwugxjvu.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
const RC_KEY = process.env.REVENUECAT_SECRET_API_KEY;

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

/** Must match PRO_ENTITLEMENT_ID in lib/revenuecat.ts. */
const ENTITLEMENT_ID = 'pro';

if (!SERVICE_KEY || !RC_KEY) {
  console.error('Both SUPABASE_SERVICE_ROLE_KEY and REVENUECAT_SECRET_API_KEY are required.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One subscriber, with a single retry on a rate limit. */
async function fetchSubscriber(uid, attempt = 0) {
  const resp = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${RC_KEY}` },
  });
  if (resp.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`  rate limited, waiting ${wait}ms`);
    await sleep(wait);
    return fetchSubscriber(uid, attempt + 1);
  }
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`RevenueCat ${resp.status}`);
  return resp.json();
}

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (nothing is written) ===');

  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error('Could not list users:', error.message);
      process.exit(1);
    }
    users.push(...data.users.map((u) => u.id));
    if (data.users.length < 1000) break;
  }
  console.log(`${users.length} accounts to check against RevenueCat.`);

  const todo = users.slice(0, LIMIT === Infinity ? users.length : LIMIT);
  const tally = { active: 0, expired: 0, none: 0, unknown: 0, failed: 0 };

  for (const [i, uid] of todo.entries()) {
    if (i > 0 && i % 25 === 0) {
      console.log(`  ...${i}/${todo.length}`);
      await sleep(250); // gentle on the API; this is a one-off, not a hot path
    }
    try {
      const json = await fetchSubscriber(uid);
      if (!json) { tally.unknown += 1; continue; }

      const ent = json?.subscriber?.entitlements?.[ENTITLEMENT_ID];
      if (!ent) { tally.none += 1; continue; }

      const expires = ent.expires_date ? new Date(ent.expires_date) : null;
      const isActive = !expires || expires.getTime() > Date.now();
      const status = isActive ? 'active' : 'expired';
      tally[isActive ? 'active' : 'expired'] += 1;

      console.log(`${uid}  ${status}  product=${ent.product_identifier ?? '?'}  expires=${ent.expires_date ?? 'never'}`);

      if (APPLY) {
        const { error } = await sb.rpc('apply_entitlement', {
          p_user: uid,
          p_product: ent.product_identifier ?? null,
          p_status: status,
          p_expires: expires ? expires.toISOString() : null,
          p_source: 'backfill',
        });
        if (error) throw new Error(`apply_entitlement: ${error.message}`);
      }
    } catch (err) {
      tally.failed += 1;
      console.error(`${uid}  FAILED: ${err.message ?? err}`);
    }
  }

  console.log('\n--- summary ---');
  console.log(tally);
  if (!APPLY) {
    console.log(
      tally.active + tally.expired === 0
        ? 'No subscribers found. Nothing to backfill.'
        : `Re-run with --apply to write ${tally.active + tally.expired} entitlement rows.`
    );
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
