/**
 * OAuth `state` values: random, single-use, 10-minute expiry, held in server memory (the app
 * runs as one process). A restart between "Connect" and the Google redirect just means the
 * user clicks Connect again.
 */
import crypto from 'crypto';

const TTL_MS = 10 * 60 * 1000;
const states = new Map<string, number>();

function prune(now: number) {
  for (const [s, exp] of states) if (exp <= now) states.delete(s);
}

export function createOAuthState(now = Date.now()): string {
  prune(now);
  const state = crypto.randomBytes(24).toString('hex');
  states.set(state, now + TTL_MS);
  return state;
}

/** True once for a state this server issued and that hasn't expired. */
export function consumeOAuthState(state: string | null | undefined, now = Date.now()): boolean {
  if (!state) return false;
  const exp = states.get(state);
  states.delete(state);
  return Boolean(exp && exp > now);
}
