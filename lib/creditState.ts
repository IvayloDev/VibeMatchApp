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
 */
export type CreditSource = 'unknown' | 'server' | 'stale';

export type CreditState = {
  /** null means "not known yet". Never render it as a number. */
  balance: number | null;
  isPro: boolean;
  nextFreeAt: Date | null;
  source: CreditSource;
};

let state: CreditState = { balance: null, isPro: false, nextFreeAt: null, source: 'unknown' };
const listeners = new Set<(s: CreditState) => void>();

export function getCreditState(): CreditState {
  return state;
}

export function subscribeToCredits(fn: (s: CreditState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

function publish(next: CreditState) {
  state = next;
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.warn('[creditState] listener threw:', err); }
  }
}

/** A fresh, authoritative reading. */
export function setServerCredits(input: {
  balance: number | null;
  isPro?: boolean;
  nextFreeAt?: string | Date | null;
}) {
  publish({
    balance: typeof input.balance === 'number' ? input.balance : state.balance,
    isPro: input.isPro ?? state.isPro,
    nextFreeAt: input.nextFreeAt
      ? (input.nextFreeAt instanceof Date ? input.nextFreeAt : new Date(input.nextFreeAt))
      : state.nextFreeAt,
    source: 'server',
  });
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

/** On sign-out or identity change, the old balance belongs to somebody else. */
export function resetCreditState() {
  publish({ balance: null, isPro: false, nextFreeAt: null, source: 'unknown' });
}
