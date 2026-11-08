type Attempt = {authorizationUrl: string; attemptId: string; expiresAt: number};
export type SavedApproval = {
  kind: 'grant' | 'revoke';
  state: string;
  id: string;
  payload: number[];
  accountId?: string;
  maxBlockHeight?: string;
  previousAuthorizedAt?: number | null;
};
export type ApprovalReturn = SavedApproval & {search: string};
const connectionMessage = 'The sign-in connection was interrupted. Please try again.';
const RESUME_KEY = 'worldo.entry.resume';
const APPROVAL_KEY = 'worldo.approval.pending';
const LEAVE_TIMEOUT_MS = 30000;
let signingIn = false;
let returned: ApprovalReturn | undefined;
class LoginRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, body?: unknown, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/near/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json();
  if (!response.ok)
    throw new LoginRequestError(typeof result.error === 'string' ? result.error : connectionMessage, response.status);
  return result as T;
}

/** Waits for the browser to leave this page. It only ends if the player cancels or
 * the navigation never happens, so a stalled redirect cannot leave Play spinning. */
export function pageLeaving(signal?: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(connectionMessage)), LEAVE_TIMEOUT_MS);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      {once: true},
    );
  });
}

/** Sign-in stays in this tab: the page goes to the provider and returns to the origin
 * callback, so no window ever opens. Identity is verified by the server using
 * OIDC + PKCE, not by requesting a signing token. */
export async function signInWithNear(signal?: AbortSignal): Promise<never> {
  signal?.throwIfAborted();
  if (signingIn) throw new Error('Finish the current authorization first.');
  signingIn = true;
  try {
    const attempt = await request<Attempt>('login/start', {}, 15000, signal);
    const url = new URL(attempt.authorizationUrl);
    if (url.protocol !== 'https:') throw new Error('Invalid sign-in response.');
    window.location.assign(url.href);
    return await pageLeaving(signal);
  } catch (error) {
    if (signal?.aborted) throw new Error('Sign-in cancelled. Please try again.');
    if (error instanceof TypeError || error instanceof DOMException) throw new Error(connectionMessage);
    throw error;
  } finally {
    signingIn = false;
  }
}

export function isNearLoginCallback(search: string) {
  const params = new URLSearchParams(search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

/** The shared testnet client permits the origin callback, so this runs at `/`
 * before the game mounts. The HttpOnly session cookie is available to this
 * same-origin POST even when it was withheld on the cross-site navigation. */
export async function completeNearLogin(search: string): Promise<void> {
  const params = new URLSearchParams(search),
    state = params.get('state');
  if (!state) throw new Error('Invalid sign-in response.');
  const error = params.get('error');
  // One code exchange, then at most two bounded JWKS and MPC reads, including
  // their backoffs, fit inside this budget. The code exchange is never replayed.
  await request('login/complete', error ? {state, error} : {state, code: params.get('code')}, 70000);
}

/** Marks sign-in as finished, so the reloaded game carries on from the player's click. */
export function markEntryResume() {
  try {
    sessionStorage.setItem(RESUME_KEY, '1');
  } catch {
    /* Continue to play still works by hand when storage is disabled. */
  }
}

/** True once, right after sign-in or approval brought the player back to this tab. */
export function takeEntryResume() {
  let resume = false;
  try {
    resume = sessionStorage.getItem(RESUME_KEY) === '1';
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* A return from approval below is still known without storage. */
  }
  return resume || returned?.kind === 'grant';
}

/** Kept in the tab while the page is away, so the return can finish the same action. */
export function saveApproval(approval: SavedApproval) {
  sessionStorage.setItem(APPROVAL_KEY, JSON.stringify(approval));
}

/** Holds an approval callback until the game has loaded. Only the state saved before
 * leaving matches, so any other callback is an ordinary sign-in. */
export function holdApprovalReturn(search: string) {
  const state = new URLSearchParams(search).get('state');
  try {
    const saved = JSON.parse(sessionStorage.getItem(APPROVAL_KEY) ?? 'null') as SavedApproval | null;
    if (!saved || !state || saved.state !== state) return false;
    sessionStorage.removeItem(APPROVAL_KEY);
    returned = {...saved, search};
    return true;
  } catch {
    return false;
  }
}

export function takeApprovalReturn(kind: SavedApproval['kind']) {
  if (returned?.kind !== kind) return undefined;
  const approval = returned;
  returned = undefined;
  return approval;
}
