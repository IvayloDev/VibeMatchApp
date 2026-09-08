/**
 * Who this install is, to the server.
 *
 * Every install gets a real Supabase user, anonymous unless they sign up. That
 * is what lets the server own the balance: a guest with no identity cannot be
 * charged, metered, or given back a credit, so "no way of setting a balance"
 * is unreachable for guests without this.
 *
 * MINTING IS LAZY, NOT AT BOOT. A cold launch never blocks on the network, and
 * an offline user still gets a working app. More importantly, App.js decides
 * between Welcome, Onboarding and MainTabs from `user` being null plus two
 * SecureStore flags, and AuthContext resolves those flags with no network at
 * all. Minting at boot would make `user` become truthy part-way through that
 * decision and bounce people between screens. So an identity appears the first
 * time something actually needs one: a scan, a purchase, or a deliberate
 * deferred kick once onboarding is finished.
 *
 * SINGLE FLIGHT. A scan tap and a buy tap in the same tick must not create two
 * anonymous users. Same pattern lib/dailyCredit.ts already uses for its claim.
 */
import { supabase } from './supabase';
import { getDeviceId } from './deviceId';
import { identifyUser, getCurrentAppUserId } from './revenuecat';
import { setServerCredits, resetCreditState } from './creditState';
import {
  captureLegacySnapshot,
  markRecovered,
  peekSnapshot,
  recoveryAlreadyDone,
  starterMarkerPresent,
} from './legacyRecovery';

let mintInFlight: Promise<string | null> | null = null;
let bootstrappedFor: string | null = null;

/** Minutes to ADD to UTC to reach local time, which is the opposite sign to getTimezoneOffset. */
function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/**
 * The uid we already have, or null. Never mints, never touches the network.
 * Screens use this to decide what to render; only actions use requireIdentity.
 */
export async function peekIdentity(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * An identity, minting one if needed. Returns null only if we genuinely could
 * not get one, in which case the caller must fail gracefully rather than
 * pretending the user has no credits.
 */
export async function requireIdentity(reason: string): Promise<string | null> {
  const existing = await peekIdentity();
  if (existing) {
    // Bootstrap is idempotent, but there is no reason to run it every call.
    if (bootstrappedFor !== existing) void afterMint(existing);
    return existing;
  }
  if (mintInFlight) return mintInFlight;

  mintInFlight = mint(reason).finally(() => { mintInFlight = null; });
  return mintInFlight;
}

async function mint(reason: string): Promise<string | null> {
  try {
    // Re-read inside the single flight: another caller may have won the race
    // between our peek and here.
    const again = await peekIdentity();
    if (again) return again;

    console.log('[identity] minting an anonymous identity, reason:', reason);
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data?.user?.id) {
      console.error('[identity] anonymous sign-in failed:', error?.message);
      return null;
    }
    const uid = data.user.id;
    await afterMint(uid);
    return uid;
  } catch (error) {
    console.error('[identity] mint threw:', error);
    return null;
  }
}

/**
 * Everything that must happen once an identity exists, in this order and
 * deliberately OUTSIDE the auth state callback: auth-js awaits every
 * onAuthStateChange subscriber, so doing this work in there would stall the
 * sign-in that is still resolving.
 */
export async function afterMint(uid: string): Promise<void> {
  bootstrappedFor = uid;
  try {
    // 1. RevenueCat has to agree who this is BEFORE anything asks it about
    //    purchases. This is also the transition that moves a guest's existing
    //    non-subscription purchases onto the Supabase uid; without it the
    //    /v1/subscribers/{uid} lookup finds nothing and recovery is impossible.
    await identifyUser(uid);
    const rcId = await getCurrentAppUserId();
    if (rcId && rcId !== uid) {
      console.warn('[identity] RevenueCat is still on a different app user id', { rcId, uid });
    }

    // 2. Starter grant, daily match, Pro backfill, pack reconcile, timezone.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const bootstrap = await postJson('session-bootstrap', token, {
      deviceId: await getDeviceId(),
      starterMarkerPresent: await starterMarkerPresent(),
      tzOffsetMinutes: tzOffsetMinutes(),
    });
    if (bootstrap?.balance !== undefined) {
      setServerCredits({
        balance: bootstrap.balance,
        isPro: bootstrap.is_pro,
        nextFreeAt: bootstrap.next_free_at,
      });
    }

    // 3. Legacy recovery, if this device has anything to recover.
    await runLegacyRecovery(uid, token);
  } catch (error) {
    console.warn('[identity] afterMint did not finish:', error);
    // Left deliberately un-fatal and un-marked: every step is idempotent and
    // the next launch or the next requireIdentity picks up where this stopped.
    bootstrappedFor = null;
  }
}

async function runLegacyRecovery(uid: string, token: string): Promise<void> {
  if (await recoveryAlreadyDone()) return;
  const snapshot = (await peekSnapshot()) ?? (await captureLegacySnapshot());
  if (!snapshot) return;

  const result = await postJson('recover-legacy-purchases', token, { snapshot });

  // `definite` and not merely a 200. A failed RevenueCat lookup, an alias that
  // has not propagated, and a subscriber who owns nothing are indistinguishable
  // from the server, so anything short of a definite answer means we keep the
  // evidence and try again next launch. Retrying costs nothing: every server
  // step is keyed on a transaction id.
  if (result?.ok && result?.definite) {
    if (typeof result.balance === 'number') setServerCredits({ balance: result.balance });
    await markRecovered(uid);
    console.log('[identity] legacy recovery complete', { grantedFromRc: result.grantedFromRc });
  } else {
    console.log('[identity] legacy recovery inconclusive, keeping local evidence', {
      ok: result?.ok, definite: result?.definite, orphaned: result?.orphaned,
    });
  }
}

async function postJson(fn: string, token: string, body: unknown): Promise<any | null> {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./supabase');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } catch (error) {
    console.warn(`[identity] ${fn} failed:`, error);
    return null;
  }
}

/**
 * Ask the server to re-read RevenueCat for this user and write what it finds.
 *
 * Call it after any purchase. session-bootstrap does its own
 * /v1/subscribers/{uid} lookup, so this does not trust the client's word about
 * what was bought - it just tells the server that now is a good moment to
 * look. That means a subscription becomes real server-side immediately rather
 * than whenever the webhook happens to arrive, and it self-heals if the
 * webhook never does.
 */
export async function bootstrapSession(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const result = await postJson('session-bootstrap', token, {
      deviceId: await getDeviceId(),
      starterMarkerPresent: await starterMarkerPresent(),
      tzOffsetMinutes: tzOffsetMinutes(),
    });
    if (result?.balance !== undefined) {
      setServerCredits({
        balance: result.balance,
        isPro: result.is_pro,
        nextFreeAt: result.next_free_at,
      });
    }
  } catch (error) {
    console.warn('[identity] bootstrapSession failed:', error);
  }
}

/** Refresh the balance from the server for whoever is currently signed in. */
export async function refreshCreditState(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('get_credit_state');
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    setServerCredits({
      balance: row.balance,
      isPro: row.is_pro,
      nextFreeAt: row.next_free_at,
    });

    // The client's RevenueCat SDK knows about a subscription the moment it is
    // bought; the server only knows once its entitlements row is written, by
    // the webhook or by a bootstrap. If they disagree in that direction, the
    // server is simply behind - so ask it to look again rather than telling a
    // paying subscriber to Go Pro.
    //
    // Only ever in this direction. A client claiming Pro the server cannot
    // confirm changes nothing on its own: bootstrapSession re-reads
    // RevenueCat server-side and believes that, not the app.
    if (!row.is_pro) {
      const { hasProEntitlement } = await import('./revenuecat');
      if (await hasProEntitlement()) {
        console.log('[identity] client says Pro but the server does not yet; re-bootstrapping');
        await bootstrapSession();
      }
    }
  } catch { /* leave whatever we had; a stale number beats a wrong zero */ }
}

/** An identity change means the balance on screen belongs to somebody else. */
export function forgetIdentityState() {
  bootstrappedFor = null;
  resetCreditState();
}
