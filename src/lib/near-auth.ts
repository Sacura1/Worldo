import {pageLeaving, saveApproval, signInWithNear, takeApprovalReturn, type ApprovalReturn} from './near-login';
export interface NearIdentity {
  accountId: string;
  publicKey: string;
  expiresAt: number;
  authMethod?: 'near-auth' | 'guest';
  network?: 'mainnet' | 'testnet';
}
type AuthConfig = {
  authConfigured: boolean;
  clientId: string | null;
  authDomain: string;
  authAudience: string;
  authGuardId: string;
  appOrigin: string;
  network: 'mainnet' | 'testnet';
  contractId: string | null;
};
let providerPromise: Promise<import('./near-provider').NearAuthProvider> | undefined;
class NearRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly receipt?: string,
    readonly submitted?: boolean,
    readonly finalizedBlockHeight?: string,
  ) {
    super(message);
  }
}
async function api<T>(path: string, body?: unknown, signal?: AbortSignal, timeoutMs = 15000): Promise<T> {
  signal?.throwIfAborted();
  const r = await fetch(`/api/near/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json();
  signal?.throwIfAborted();
  if (!r.ok)
    throw new NearRequestError(
      data.error || 'NEAR sign-in unavailable.',
      r.status,
      typeof data.hash === 'string' ? data.hash : undefined,
      typeof data.submitted === 'boolean' ? data.submitted : undefined,
      typeof data.finalizedBlockHeight === 'string' ? data.finalizedBlockHeight : undefined,
    );
  return data as T;
}
async function provider(configuration?: AuthConfig) {
  if (!providerPromise)
    providerPromise = (async () => {
      const config = configuration ?? (await api<AuthConfig>('status'));
      if (!config.authConfigured || !config.clientId)
        throw new Error('NEAR sign-in is not configured for this network.');
      const {NearAuthProvider} = await import('./near-provider');
      return new NearAuthProvider({
        clientId: config.clientId,
        domain: config.authDomain,
        audience: config.authAudience,
        guardId: config.authGuardId,
        appOrigin: config.appOrigin,
      });
    })().catch(error => {
      providerPromise = undefined;
      throw error;
    });
  return providerPromise;
}
export async function getNearIdentity(signal?: AbortSignal): Promise<NearIdentity | null> {
  return (await api<{identity: NearIdentity | null}>('identity', undefined, signal)).identity;
}
export const loginNear = signInWithNear;
export async function logoutNear() {
  await api('logout', {});
  const auth = await provider();
  providerPromise = undefined;
  await auth.logout();
}

export interface GameplaySession {
  accountId: string;
  publicKey: string;
  contractId: string;
  network: string;
  expiresAt: number;
  spendLimit: number;
  spent: number;
  authorizedAt: number;
  state: 'pending' | 'active' | 'revoked';
  createdAt: number;
}
type GameplayScope = {network?: string; contractId?: string | null};
export function isUsableGameplaySession(
  session: GameplaySession | null | undefined,
  expectedAccountId: string,
  scope: GameplayScope = {},
): session is GameplaySession {
  return Boolean(
    session &&
    session.accountId === expectedAccountId &&
    (!scope.network || session.network === scope.network) &&
    (!scope.contractId || session.contractId === scope.contractId) &&
    session.state === 'active' &&
    Number.isFinite(session.expiresAt) &&
    session.expiresAt > Date.now() &&
    Number.isSafeInteger(session.spendLimit) &&
    session.spendLimit > 0 &&
    Number.isSafeInteger(session.spent) &&
    session.spent >= 0 &&
    session.spent < session.spendLimit,
  );
}
export async function getGameplaySession(signal?: AbortSignal): Promise<GameplaySession | null> {
  return (await api<{session: GameplaySession | null}>('gameplay-session/status', {}, signal)).session;
}
export type GameplayAuthorizationOptions = {signal?: AbortSignal; expectedAccountId?: string};
const continueSetup = 'Continue to play to finish account setup.';
const pendingSetup = 'Account setup is still being confirmed. Continue to play to check again.';
type PendingGrant = {previousAuthorizedAt: number | null; maxBlockHeight?: string};
type GrantConfirmation = {session: GameplaySession | null; finalizedBlockHeight?: string};
const pendingInMemory = new Map<string, PendingGrant>();
let authorizingGameplay = false;
function pendingKey(accountId: string, scope: GameplayScope) {
  return `worldo.pendingGameplay.${scope.network}.${scope.contractId}.${accountId}`;
}
function rememberPending(key: string, pending: PendingGrant | null) {
  if (pending) pendingInMemory.set(key, pending);
  else pendingInMemory.delete(key);
  try {
    if (pending) sessionStorage.setItem(key, JSON.stringify(pending));
    else sessionStorage.removeItem(key);
  } catch {
    /* The memory marker still protects retries when storage is disabled. */
  }
}
function pendingGrant(key: string): PendingGrant | undefined {
  const memory = pendingInMemory.get(key);
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const value = JSON.parse(raw) as PendingGrant;
    return {
      previousAuthorizedAt: Number.isFinite(value.previousAuthorizedAt) ? value.previousAuthorizedAt : null,
      maxBlockHeight: typeof value.maxBlockHeight === 'string' ? value.maxBlockHeight : undefined,
    };
  } catch {
    return undefined;
  }
}
function blockHeight(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return;
  const height = BigInt(value);
  return height <= 18446744073709551615n ? height : undefined;
}
function delegateExpired(pending: PendingGrant, finalizedHeight: unknown) {
  const limit = blockHeight(pending.maxBlockHeight),
    height = blockHeight(finalizedHeight);
  return limit !== undefined && height !== undefined && height > limit;
}
function confirmGameplaySession(signal?: AbortSignal) {
  return api<GrantConfirmation>('gameplay-session/confirm', {}, signal, 30000);
}
function sameGrantOwner(session: GameplaySession, identity: NearIdentity, config: AuthConfig) {
  return (
    session.accountId === identity.accountId &&
    session.publicKey === identity.publicKey &&
    session.network === config.network &&
    session.contractId === config.contractId
  );
}
function noExistingGrant(error: unknown) {
  return (
    error instanceof NearRequestError &&
    error.status === 422 &&
    error.message === 'Authorize Worldo game-token settlement first.'
  );
}
/** Relays an approved grant and proves its outcome from a FINAL chain read. */
async function relayGrant(
  approved: ApprovalReturn,
  token: string,
  key: string,
  valid: (value: GameplaySession | null | undefined) => value is GameplaySession,
) {
  // Once dispatched, cancellation cannot prove the transaction was unsent.
  // Retain a non-secret recovery marker through reload; never automatically
  // repeat the relay or approve another grant while its outcome is uncertain.
  const marker: PendingGrant = {
    previousAuthorizedAt: approved.previousAuthorizedAt ?? null,
    maxBlockHeight: approved.maxBlockHeight,
  };
  rememberPending(key, marker);
  let relayFailure: unknown;
  try {
    await api('relay', {id: approved.id, token}, undefined, 90000);
  } catch (error) {
    relayFailure = error;
  }
  let confirmed: GameplaySession | null = null,
    confirmationHeight: string | undefined;
  try {
    const result = await confirmGameplaySession();
    confirmed = result.session;
    confirmationHeight = result.finalizedBlockHeight;
  } catch (error) {
    if (noExistingGrant(error))
      confirmationHeight = (error as NearRequestError)
        .finalizedBlockHeight; /* The next explicit attempt performs this same read-only recovery. */
  }
  if (
    valid(confirmed) &&
    (marker.previousAuthorizedAt === null || confirmed.authorizedAt !== marker.previousAuthorizedAt)
  ) {
    rememberPending(key, null);
    return confirmed;
  }
  if (
    relayFailure instanceof NearRequestError &&
    (relayFailure.submitted === false ||
      (relayFailure.receipt && relayFailure.message.startsWith('The game transaction failed.')))
  ) {
    rememberPending(key, null);
    throw relayFailure;
  }
  if (delegateExpired(marker, confirmationHeight)) {
    rememberPending(key, null);
    if (valid(confirmed)) return confirmed;
    throw new Error(continueSetup);
  }
  throw new Error(pendingSetup);
}
/** Explicit onboarding consent for bounded Worldo game-token settlement. Approval
 * leaves this page, and calling this again on return finishes that same approval.
 * The operator cannot transfer native NEAR or assets in other applications. */
export async function authorizeGameplaySession(options: GameplayAuthorizationOptions = {}): Promise<GameplaySession> {
  options.signal?.throwIfAborted();
  if (authorizingGameplay) throw new Error('Finish the current authorization first.');
  authorizingGameplay = true;
  let relayDispatched = false;
  try {
    const [identity, config] = await Promise.all([
      getNearIdentity(options.signal),
      api<AuthConfig>('status', undefined, options.signal),
    ]);
    options.signal?.throwIfAborted();
    if (!identity || identity.expiresAt <= Date.now()) throw new Error('Sign in first.');
    if (
      (options.expectedAccountId && identity.accountId !== options.expectedAccountId) ||
      (identity.network && identity.network !== config.network)
    )
      throw new Error('Your signed-in account changed. Please sign in again.');
    if (!config.contractId) throw new Error('Gameplay authorization is unavailable.');
    const key = pendingKey(identity.accountId, config),
      valid = (value: GameplaySession | null | undefined): value is GameplaySession =>
        Boolean(
          value &&
          sameGrantOwner(value, identity, config) &&
          isUsableGameplaySession(value, identity.accountId, config),
        );
    const approved = takeApprovalReturn('grant');
    if (approved) {
      if (approved.accountId !== identity.accountId)
        throw new Error('Your signed-in account changed. Please sign in again.');
      const auth = await provider(config);
      options.signal?.throwIfAborted();
      const token = await auth.finishApproval(approved.search, approved.payload);
      options.signal?.throwIfAborted();
      relayDispatched = true;
      return await relayGrant(approved, token, key, valid);
    }
    const existing = await getGameplaySession(options.signal);
    if (existing && !sameGrantOwner(existing, identity, config))
      throw new Error('Your signed-in account changed. Please sign in again.');
    const pending = pendingGrant(key);
    if (valid(existing) && !pending) return existing;
    // /status is a local cache. A FINAL chain read recovers a previously submitted
    // approval before another grant can reset its accumulated spending.
    let recovered: GameplaySession | null = null,
      finalizedBlockHeight: string | undefined;
    try {
      const confirmation = await confirmGameplaySession(options.signal);
      recovered = confirmation.session;
      finalizedBlockHeight = confirmation.finalizedBlockHeight;
    } catch (error) {
      if (!noExistingGrant(error)) throw error;
      finalizedBlockHeight = (error as NearRequestError).finalizedBlockHeight;
    }
    if (recovered && !sameGrantOwner(recovered, identity, config))
      throw new Error('Your signed-in account changed. Please sign in again.');
    if (
      valid(recovered) &&
      (!pending || pending.previousAuthorizedAt === null || recovered.authorizedAt !== pending.previousAuthorizedAt)
    ) {
      rememberPending(key, null);
      return recovered;
    }
    if (pending) {
      // The server's height belongs to the same FINAL grant read. A later head
      // height or wall-clock timeout cannot prove a submitted delegate expired.
      if (!delegateExpired(pending, finalizedBlockHeight)) throw new Error(pendingSetup);
      rememberPending(key, null);
      if (valid(recovered)) return recovered;
    }
    options.signal?.throwIfAborted();
    await api('prepare-wallet', {}, options.signal, 60000);
    options.signal?.throwIfAborted();
    const prepared = await api<{
      id: string;
      payload: number[];
      kind: string;
      network: string;
      publicKey: string;
      session: GameplaySession;
      maxBlockHeight: string;
    }>('gameplay-session/prepare', {}, options.signal, 60000);
    if (
      prepared.kind !== 'delegateAction' ||
      prepared.network !== config.network ||
      prepared.publicKey !== identity.publicKey ||
      !prepared.session ||
      !sameGrantOwner(prepared.session, identity, config)
    )
      throw new Error('Your signed-in account changed. Please sign in again.');
    if (blockHeight(prepared.maxBlockHeight) === undefined) throw new Error('Gameplay authorization is unavailable.');
    const auth = await provider(config);
    options.signal?.throwIfAborted();
    await auth.beginApproval(prepared.payload, state =>
      saveApproval({
        kind: 'grant',
        state,
        id: prepared.id,
        payload: prepared.payload,
        accountId: identity.accountId,
        maxBlockHeight: prepared.maxBlockHeight,
        previousAuthorizedAt: recovered?.authorizedAt ?? existing?.authorizedAt ?? null,
      }),
    );
    return await pageLeaving(options.signal);
  } catch (error) {
    if (options.signal?.aborted && !relayDispatched) throw new Error('Authorization cancelled.');
    throw error;
  } finally {
    authorizingGameplay = false;
  }
}
export async function recoverGameplaySession(signal?: AbortSignal): Promise<GameplaySession | null> {
  return (await confirmGameplaySession(signal)).session;
}
export async function revokeGameplaySession() {
  const prepared = await api<{id: string; payload: number[]}>('gameplay-session/revoke-prepare', {}),
    auth = await provider();
  await auth.beginApproval(prepared.payload, state =>
    saveApproval({kind: 'revoke', state, id: prepared.id, payload: prepared.payload}),
  );
  return pageLeaving();
}
/** Finishes a revocation the player approved before this page loaded. */
export async function finishGameplayRevocation() {
  const approved = takeApprovalReturn('revoke');
  if (!approved) return false;
  const auth = await provider();
  const token = await auth.finishApproval(approved.search, approved.payload);
  await api('relay', {id: approved.id, token});
  return true;
}
