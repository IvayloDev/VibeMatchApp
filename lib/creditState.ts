/**
 * The balance, as the server last reported it. One record, one subscribe API.
 *
 * The important part is `source`. Before the server has answered, the balance
 * is NULL and the source is 'unknown', and that is not the same as zero. The
 * old code returned 0 from getUserCredits on any failure, and screens gate on
 * that number: DashboardScreen refuses to open the picker below 1 and shows
 * "next free match in ...". So a user with a paid pack, on a bad connection,
 * would be shown a wall for credits they own. A placeholder is honest; a zero
 * is a lie the UI acts on.
 *
 * The same rule now covers the daily counters. Every "not known yet" field in
 * here is null, and nothing in this module ever turns a null into a number.
 */
export type CreditSource = 'unknown' | 'server' | 'stale';

export type CreditState = {
  /** null means "not known yet". Never render it as a number. */
  balance: number | null;
  isPro: boolean;
  /**
   * When the next free match lands, or null.
   *
   * null carries meaning now, and it is not "we have not asked": the server
   * returns NULL once a never-paying user has spent the whole free daily
   * allowance, which is the point where the app must stop promising a match
   * tomorrow and offer the paywall instead. It is also null before the first
   * answer arrives, so never read it alone - `freeExhausted` below does the
   * reading, and it stays false until the server has actually said.
   */
  nextFreeAt: Date | null;
  /**
   * Pro matches used in the current match-day, counted by the server from
   * match_charges. The client used to keep its own count in AsyncStorage and
   * stopped incrementing it when charging moved server-side, so the number on
   * screen froze at 10-of-10 while the server enforced the real cap.
   */
  proUsedToday: number | null;
  proDailyLimit: number;
  /**
   * Free daily matches this user has taken out of the lifetime allowance,
   * counted by the server. null until the server has said, and a null must
   * never be shown as 0: "0 of 30 used" to somebody who has used all 30 is the
   * same class of lie as the old zero balance.
   */
  freeDailyUsed: number | null;
  freeDailyLimit: number;
  /**
   * The free allowance is spent: no more daily matches are coming, ever, and
   * only a purchase produces another match.
   *
   * Derived on every publish, never assigned by a caller - see publish().
   */
  freeExhausted: boolean;
  source: CreditSource;
};

/**
 * 30 free matches, lifetime, for a user who never pays, and 10 Pro matches a
 * day. Both are the server's numbers; these are only what we believe until it
 * says otherwise, so the first render is not blank.
 */
const EMPTY: CreditState = {
  balance: null,
  isPro: false,
  nextFreeAt: null,
  proUsedToday: null,
  proDailyLimit: 10,
  freeDailyUsed: null,
  freeDailyLimit: 30,
  freeExhausted: false,
  source: 'unknown',
};

let state: CreditState = { ...EMPTY };
const listeners = new Set<(s: CreditState) => void>();

export function getCreditState(): CreditState {
  return state;
}

export function subscribeToCredits(fn: (s: CreditState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

/**
 * Is the free daily allowance spent, on the evidence we actually hold?
 *
 * Three conditions, and every one of them is load-bearing:
 *
 *  - Pro users are not on the allowance at all, and a subscriber must never be
 *    told their free matches ran out.
 *  - freeDailyUsed !== null is the proof that this reading came from a real
 *    get_credit_state or session-bootstrap answer. Without it a scan response,
 *    which carries a balance and nothing else, would flip source to 'server'
 *    while nextFreeAt is still the null it was born with, and the first scan on
 *    a fresh install would wall the user.
 *  - nextFreeAt === null is the server's own statement that nothing more is
 *    coming. It is the authority here, not the used/limit arithmetic, because
 *    it is the same value the countdown is drawn from.
 */
function freeAllowanceSpent(s: Omit<CreditState, 'freeExhausted'>): boolean {
  if (s.isPro) return false;
  if (s.freeDailyUsed === null) return false;
  return s.nextFreeAt === null;
}

/**
 * freeExhausted is computed here rather than by the writers because half of
 * them publish a spread of the previous state - `{ ...state, isPro }` - and a
 * spread would carry the old flag forward. Somebody who subscribed one second
 * ago would keep being told their free matches are gone. Deriving on every
 * publish makes it impossible for the flag to disagree with the fields it
 * comes from, and makes it impossible for a caller to set it by hand.
 */
function publish(next: Omit<CreditState, 'freeExhausted'>) {
  state = { ...next, freeExhausted: freeAllowanceSpent(next) };
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.warn('[creditState] listener threw:', err); }
  }
}

/**
 * A timestamp from the server.
 *
 * null is an answer ("no next free match"), so it is passed straight through.
 * An unparseable value is NOT that answer - it is a value we could not read -
 * so it keeps whatever we had. Turning it into null would silently retire the
 * user's daily match, and turning it into an Invalid Date would print "NaN"
 * where the countdown goes.
 */
function parseServerDate(value: string | Date | null, fallback: Date | null): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * A fresh, authoritative reading.
 *
 * Every optional field distinguishes undefined from null on purpose. undefined
 * means the caller is not reporting that field and we keep what we have, which
 * is what a partial update like a scan response or a merge result sends. null
 * means the server reported the field as empty. Collapsing the two is how a
 * missing key from an older Edge Function would come out looking like "your
 * free matches are over".
 */
export function setServerCredits(input: {
  balance: number | null;
  isPro?: boolean;
  nextFreeAt?: string | Date | null;
  proUsedToday?: number | null;
  proDailyLimit?: number | null;
  freeDailyUsed?: number | null;
  freeDailyLimit?: number | null;
}) {
  publish({
    balance: typeof input.balance === 'number' ? input.balance : state.balance,
    isPro: input.isPro ?? state.isPro,
    nextFreeAt: input.nextFreeAt === undefined
      ? state.nextFreeAt
      : parseServerDate(input.nextFreeAt, state.nextFreeAt),
    proUsedToday: typeof input.proUsedToday === 'number' ? input.proUsedToday : state.proUsedToday,
    proDailyLimit: typeof input.proDailyLimit === 'number' ? input.proDailyLimit : state.proDailyLimit,
    freeDailyUsed: typeof input.freeDailyUsed === 'number' ? input.freeDailyUsed : state.freeDailyUsed,
    freeDailyLimit: typeof input.freeDailyLimit === 'number' ? input.freeDailyLimit : state.freeDailyLimit,
    source: 'server',
  });
}

/** Pro matches left today, or null until the server has said. */
export function proRemaining(s: CreditState = state): number | null {
  if (s.proUsedToday === null) return null;
  return Math.max(0, s.proDailyLimit - s.proUsedToday);
}

/**
 * Free daily matches left in the lifetime allowance, or null until the server
 * has said. Screens must render the null as a dash, not as a number: see
 * creditsKnown below for why guessing is worse than admitting.
 */
export function freeDailyRemaining(s: CreditState = state): number | null {
  if (s.freeDailyUsed === null) return null;
  return Math.max(0, s.freeDailyLimit - s.freeDailyUsed);
}

/**
 * Has the server told us anything about this user yet?
 *
 * false means every counter in here is a placeholder. A screen that writes
 * `proUsedToday ?? 0` in that state puts "10 of 10 matches left today" in front
 * of an offline Pro user who may in fact have none left, and the next scan then
 * gets refused by a server the UI just contradicted. refreshCreditState
 * swallows its failures on purpose - a stale number beats a wrong zero - so the
 * only way a screen can tell is by asking here, or by treating the null from
 * proRemaining/freeDailyRemaining as "render a dash".
 */
export function creditsKnown(s: CreditState = state): boolean {
  return s.source !== 'unknown';
}

/**
 * A scan response carries the balance after the charge, which is the freshest
 * number that exists. Used so the UI does not need a round trip to catch up.
 */
export function applyScanCredits(credits: { balance?: number | null; meter?: string } | undefined) {
  if (!credits || typeof credits.balance !== 'number') return;
  publish({ ...state, balance: credits.balance, source: 'server' });
}

/**
 * Mark what we hold as possibly out of date without throwing it away: a stale
 * number is still better to show than a placeholder, as long as nothing gates
 * on it. Callers that gate must require source === 'server'.
 */
export function markCreditsStale() {
  if (state.source === 'server') publish({ ...state, source: 'stale' });
}

/**
 * RevenueCat told us the subscription changed, on this device, right now.
 *
 * This moves `isPro` only. It is a UI fact, not an authorisation: the server
 * still decides what a scan costs, and it decides from its own RevenueCat
 * lookup. But a subscriber must never be shown "Go Pro" for the seconds it
 * takes the server to agree, so the moment the SDK knows, the app knows. The
 * same publish clears freeExhausted, because a subscriber is not on the free
 * allowance any more.
 */
export function setProFromClient(isPro: boolean) {
  if (state.isPro === isPro) return;
  publish({ ...state, isPro });
}

/** On sign-out or identity change, the old balance belongs to somebody else. */
export function resetCreditState() {
  publish({ ...EMPTY });
}
