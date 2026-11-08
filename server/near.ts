import {Router, type Request} from 'express';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet} from 'jose';
import {KeyPair} from '@near-js/crypto';
import {
  prepareGameplaySession,
  loadGameplaySession,
  loadGuestRecord,
  saveGameAuthority,
  saveGuestRecord,
} from './gameplay-sessions';
import {refillGuests, takeGuest, type GuestAccount} from './guest-accounts';
import {
  appMode,
  guestPlayEnabled,
  publicRpcUrl,
  nearAuthConfiguration,
  nearAuthDerivationPath,
  nearNetworkConfiguration,
  transactionExplorerUrl,
  assertNearRpcNetwork,
} from './near-config';
import {
  productionReadinessSnapshot,
  getProductionReadiness,
  socialSignInConfigured,
  assertAccountReady,
  assertTransactionReady,
} from './production-readiness';
import {actionCost, prepareGameTransaction, assertSponsoredDelegate} from './transaction-policy';
import {
  localRelayerConfigured,
  relayAuthorizedSignature,
  submitSponsoredDelegate,
  submitUserTransaction,
  provisionNearWallet,
} from './relayer';
import {NearLogin} from './near-login';
import {GameError} from './errors';
import {NEAR_AUTH_AWAITING_APPROVAL} from '../shared/near-auth';
import {readLoginPublicKey} from './login-public-key';
import {verifyNearSigningToken} from './near-signing-token';

const issuerKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function authKeys(issuer: string) {
  let keys = issuerKeys.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer));
    issuerKeys.set(issuer, keys);
  }
  return keys;
}
function verifyAuthToken(token: string) {
  const config = nearAuthConfiguration();
  return verifyNearSigningToken(token, config, authKeys(config.issuer));
}
export type NearIdentity = {
  accountId: string;
  publicKey: string;
  expiresAt: number;
  authSubject: string;
  authMethod?: 'near-auth' | 'guest';
};
const GUEST_SESSION_MS = 30 * 24 * 60 * 60_000;
const identities = new Map<string, NearIdentity>();
const login = new NearLogin<NearIdentity>({
  config: nearAuthConfiguration,
  enabled: socialSignInConfigured,
  deriveIdentity: async (subject, config) => {
    const chain = nearNetworkConfiguration();
    const {publicKey, accountId} = await readLoginPublicKey({...chain, path: nearAuthDerivationPath(subject, config)});
    return {authSubject: subject, authMethod: 'near-auth', accountId, publicKey, expiresAt: Date.now() + 60 * 60_000};
  },
  saveIdentity: (sid, identity) => {
    identities.set(sid, identity);
  },
});
type PendingAction = ReturnType<typeof prepareGameTransaction> & {
  session: string;
  ownerAccountId: string;
  expiresAt: number;
  method: string;
  deposit: string;
  reviewedFeeCeiling?: string;
  gameplayPublicKey?: string;
  gameplayOperation?: 'add' | 'remove';
};
const pendingActions = new Map<string, PendingAction>();
export function sessionId(req: Request): string {
  const id = (req as Request & {sessionId?: string}).sessionId;
  if (!id) throw new Error('Start a game session first.');
  return id;
}
export function getVerifiedIdentity(req: Request): NearIdentity | null {
  const id = identities.get(sessionId(req));
  if (!id || id.expiresAt < Date.now()) return null;
  return id;
}
const guestIdentity = (guest: GuestAccount): NearIdentity => ({
  ...guest,
  authSubject: 'guest',
  authMethod: 'guest',
  expiresAt: Date.now() + GUEST_SESSION_MS,
});
const checkedGuestSessions = new Set<string>();
/** A returning guest keeps the same save, even after the server restarts. */
export async function restoreGuestIdentity(session: string) {
  if (!guestPlayEnabled() || identities.has(session) || checkedGuestSessions.has(session)) return;
  checkedGuestSessions.add(session);
  if (checkedGuestSessions.size > 20000) checkedGuestSessions.clear();
  const record = await loadGuestRecord(session);
  if (record) identities.set(session, guestIdentity(record));
}
export function nearConfiguration() {
  const auth = nearAuthConfiguration(),
    chain = nearNetworkConfiguration(),
    productMode = appMode(),
    readiness = productionReadinessSnapshot();
  const internalTestnet = chain.testnet && productMode === 'development';
  const authConfigured = socialSignInConfigured();
  const contractId = process.env.NEAR_CONTRACT_ID || null;
  const accountOperationsEnabled =
    authConfigured && Boolean(contractId) && chain.chainEnabled && (internalTestnet || readiness.accountReady);
  const liveEnabled = accountOperationsEnabled;
  const liveGameplayEnabled =
    accountOperationsEnabled &&
    (internalTestnet || readiness.ready) &&
    Boolean(
      process.env.NEAR_ORACLE_ACCOUNT_ID &&
        process.env.NEAR_ORACLE_PRIVATE_KEY &&
        (process.env.DATABASE_URL || chain.testnet) &&
        process.env.NEAR_REFINERY_ACCOUNT &&
        process.env.NEAR_MOTOR_ACCOUNT &&
        process.env.NEAR_HARBOR_ACCOUNT,
    ) &&
    (localRelayerConfigured() || Boolean(process.env.NEAR_AUTH_RELAYER_URL));
  return {
    ...chain,
    rpcUrl: publicRpcUrl(chain.rpcUrl),
    productMode,
    defaultWorld: 'live',
    productionReady: readiness.ready,
    readiness,
    authConfigured,
    clientId: authConfigured ? auth.clientId : null,
    authDomain: auth.domain,
    authAudience: auth.audience,
    authGuardId: auth.guardId,
    appOrigin: auth.appOrigin,
    contractConfigured: Boolean(contractId),
    contractId,
    liveEnabled,
    accountOperationsEnabled,
    liveGameplayEnabled,
    walletSetupEnabled: liveEnabled && localRelayerConfigured(),
    relayerConfigured: localRelayerConfigured() || Boolean(process.env.NEAR_AUTH_RELAYER_URL),
    message:
      accountOperationsEnabled && !liveGameplayEnabled
        ? 'City activities are temporarily unavailable while the economy reconnects.'
        : liveEnabled
          ? chain.testnet
            ? 'Connected to NEAR testnet. Test tokens have no monetary value.'
            : 'Your Worldo account uses NEAR mainnet.'
          : !authConfigured
            ? 'Worldo sign-in is not available at this address yet.'
            : 'Worldo is preparing to open. Transactions are unavailable until setup is verified.',
  };
}
export async function nearRpc<T>(params: Record<string, unknown>, method = 'query'): Promise<T> {
  const response = await fetch(nearNetworkConfiguration().rpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'worldo', method, params}),
    signal: AbortSignal.timeout(method === 'query' ? 15000 : 60000),
  });
  if (!response.ok) throw new Error('NEAR is temporarily unavailable.');
  const body = (await response.json()) as {result?: T; error?: unknown};
  if (body.error || body.result === undefined) throw new Error('Unable to read the NEAR account.');
  return body.result;
}
export async function viewContract<T>(accountId: string, method: string, args: unknown): Promise<T> {
  const result = await nearRpc<{result: number[]}>({
    request_type: 'call_function',
    finality: 'final',
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(result.result).toString()) as T;
}
class MissingGameplayAuthority extends Error {
  constructor(readonly finalizedBlockHeight: string) {
    super('Authorize Worldo game-token settlement first.');
  }
}
/** Reads the grant from a FINAL chain state and records it for the game. */
async function confirmAuthority(identity: Pick<NearIdentity, 'accountId' | 'publicKey'>) {
  // The height belongs to this exact FINAL state query. A separate head read
  // could overstate how far the returned authorization has actually finalized.
  const result = await nearRpc<{result: number[]; block_height: number}>({
    request_type: 'call_function',
    finality: 'final',
    account_id: process.env.NEAR_CONTRACT_ID!,
    method_name: 'game_authority',
    args_base64: Buffer.from(JSON.stringify({account_id: identity.accountId})).toString('base64'),
  });
  if (!Number.isSafeInteger(result.block_height) || result.block_height < 0)
    throw new Error('Could not confirm gameplay authorization.');
  const finalizedBlockHeight = String(result.block_height),
    grant = JSON.parse(Buffer.from(result.result).toString()) as {
      expires_at: number;
      spend_limit: number;
      spent: number;
      revoked: boolean;
      authorized_at: number;
    } | null;
  if (grant === null) throw new MissingGameplayAuthority(finalizedBlockHeight);
  if (
    !grant ||
    typeof grant !== 'object' ||
    Array.isArray(grant) ||
    typeof grant.revoked !== 'boolean' ||
    !Number.isSafeInteger(grant.expires_at) ||
    grant.expires_at <= 0 ||
    !Number.isSafeInteger(grant.authorized_at) ||
    grant.authorized_at < 0 ||
    !Number.isSafeInteger(grant.spend_limit) ||
    grant.spend_limit <= 0 ||
    !Number.isSafeInteger(grant.spent) ||
    grant.spent < 0 ||
    grant.spent > grant.spend_limit
  )
    throw new Error('Could not confirm gameplay authorization.');
  const local = await loadGameplaySession(identity.accountId, 'game-authority'),
    frozen = local?.authorizedAt === grant.authorized_at && local.state === 'revoked';
  const session = {
    accountId: identity.accountId,
    publicKey: identity.publicKey,
    contractId: process.env.NEAR_CONTRACT_ID!,
    network: nearNetworkConfiguration().network,
    expiresAt: grant.expires_at,
    spendLimit: grant.spend_limit,
    state: grant.revoked || frozen ? ('revoked' as const) : ('active' as const),
    createdAt: grant.authorized_at,
    authorizedAt: grant.authorized_at,
    spent: grant.spent,
  };
  await saveGameAuthority(session);
  return {session, finalizedBlockHeight};
}
const guestChain = {nearRpc, executionSucceeded, confirm: confirmAuthority};
/** Prepares accounts ahead of the first visitor, so guest entry is quick. */
export function prepareGuestAccounts() {
  if (guestPlayEnabled()) void refillGuests(guestChain);
}
export function executionSucceeded(outcome: Record<string, unknown>): boolean {
  const status = outcome.status;
  if (!status || typeof status !== 'object' || !('SuccessValue' in status)) return false;
  const receipts = outcome.receipts_outcome;
  return (
    !Array.isArray(receipts) ||
    receipts.every(receipt => {
      const receiptStatus = receipt?.outcome?.status;
      return !receiptStatus || typeof receiptStatus !== 'object' || !('Failure' in receiptStatus);
    })
  );
}
export function createNearRouter(
  options: {
    freezeGameAuthority?: (accountId: string, authorizedAt: number) => Promise<{lastAcceptedNonce: number}>;
  } = {},
) {
  const router = Router();
  router.get('/status', async (req, res, next) => {
    try {
      if (req.query.readiness === '1') await getProductionReadiness();
      res.json(nearConfiguration());
    } catch (error) {
      next(error);
    }
  });
  router.get('/readiness', async (_req, res, next) => {
    try {
      res.json(await getProductionReadiness());
    } catch (error) {
      next(error);
    }
  });
  router.use(
    [
      '/prepare-wallet',
      '/relay',
      '/gameplay-session/prepare',
      '/gameplay-session/confirm',
      '/gameplay-session/revoke-prepare',
    ],
    async (_req, res, next) => {
      try {
        await assertAccountReady();
        next();
      } catch {
        res.status(503).json({error: 'Account transactions are unavailable while Worldo completes its NEAR setup.'});
      }
    },
  );
  router.get('/network-status', async (_req, res) => {
    try {
      const result = await assertNearRpcNetwork();
      res.json({...result, rpcUrl: publicRpcUrl(result.rpcUrl)});
    } catch {
      res.status(503).json({error: 'RPC network verification failed.'});
    }
  });
  router.get('/identity', (req, res) => {
    const i = getVerifiedIdentity(req);
    res.json({
      identity: i
        ? {
            accountId: i.accountId,
            publicKey: i.publicKey,
            expiresAt: i.expiresAt,
            authMethod: i.authMethod || 'near-auth',
            network: nearNetworkConfiguration().network,
          }
        : null,
    });
  });
  const guestRequests = new Map<string, {since: number; count: number}>();
  router.post('/guest', async (req, res, next) => {
    try {
      if (!guestPlayEnabled()) {
        res.status(404).json({error: 'Guest play is not available here.'});
        return;
      }
      const session = sessionId(req),
        current = getVerifiedIdentity(req);
      if (current) {
        res.json({
          identity: {
            accountId: current.accountId,
            publicKey: current.publicKey,
            expiresAt: current.expiresAt,
            authMethod: current.authMethod,
            network: nearNetworkConfiguration().network,
          },
        });
        return;
      }
      const now = Date.now(),
        ip = req.ip ?? 'unknown',
        hit = guestRequests.get(ip);
      if (hit && now - hit.since < 3600_000 && hit.count >= 6) {
        res.status(429).json({error: 'Too many guest accounts from this address. Try again later.'});
        return;
      }
      guestRequests.set(
        ip,
        hit && now - hit.since < 3600_000 ? {since: hit.since, count: hit.count + 1} : {since: now, count: 1},
      );
      const guest = await takeGuest(guestChain);
      await saveGuestRecord(session, guest);
      const identity = guestIdentity(guest);
      identities.set(session, identity);
      res.json({
        identity: {
          accountId: identity.accountId,
          publicKey: identity.publicKey,
          expiresAt: identity.expiresAt,
          authMethod: 'guest',
          network: nearNetworkConfiguration().network,
        },
      });
    } catch (error) {
      console.warn('Guest setup failed', error instanceof Error ? error.message : 'unknown');
      res.status(503).json({error: 'Guest play is busy right now. Please try again in a moment.'});
      void next;
    }
  });
  router.post('/login/start', async (req, res) => {
    if (!(await login.originAccepted())) throw new GameError(NEAR_AUTH_AWAITING_APPROVAL, 409);
    res.json(login.start(sessionId(req)));
  });
  router.post('/login/complete', async (req, res) => res.json(await login.complete(sessionId(req), req.body ?? {})));
  router.get('/login/status', (req, res) => res.json(login.status(sessionId(req), req.query.attemptId)));
  router.post('/login/cancel', (req, res) => {
    login.cancel(sessionId(req), req.body?.attemptId);
    res.json({ok: true});
  });
  router.post('/logout', (req, res) => {
    identities.delete(sessionId(req));
    login.cancelSession(sessionId(req));
    res.json({ok: true});
  });
  router.get('/balance', async (req, res) => {
    const identity = getVerifiedIdentity(req);
    if (!identity) {
      res.status(401).json({error: 'Sign in first.'});
      return;
    }
    try {
      const [account, wrappedAmount, storage] = await Promise.all([
        nearRpc<{amount: string}>({request_type: 'view_account', finality: 'final', account_id: identity.accountId}),
        viewContract<string>(nearNetworkConfiguration().wrappedToken, 'ft_balance_of', {
          account_id: identity.accountId,
        }),
        viewContract<unknown>(nearNetworkConfiguration().wrappedToken, 'storage_balance_of', {
          account_id: identity.accountId,
        }),
      ]);
      res.json({
        accountId: identity.accountId,
        amount: account.amount,
        wrappedAmount,
        decimals: 24,
        walletReady: Boolean(storage),
        network: nearNetworkConfiguration().network,
      });
    } catch {
      res.status(503).json({error: 'The account balance is not available yet.'});
    }
  });
  router.post('/prepare-wallet', async (req, res) => {
    const identity = getVerifiedIdentity(req);
    if (!identity || !nearConfiguration().liveEnabled) {
      res.status(403).json({error: 'Sign in to an enabled NEAR deployment first.'});
      return;
    }
    try {
      res.json(await provisionNearWallet(identity.accountId));
    } catch (error) {
      res.status(503).json({error: error instanceof Error ? error.message : 'Wallet preparation is unavailable.'});
    }
  });
  router.get('/account', async (req, res) => {
    const identity = getVerifiedIdentity(req),
      config = nearConfiguration();
    if (!identity || !config.contractId) {
      res.status(403).json({error: 'Sign in to an enabled NEAR deployment first.'});
      return;
    }
    try {
      res.json({
        account: await viewContract(config.contractId, 'account', {account_id: identity.accountId}),
        paused: await viewContract(config.contractId, 'is_paused', {}),
        network: nearNetworkConfiguration().network,
      });
    } catch {
      res.status(503).json({error: 'The game contract could not be read.'});
    }
  });
  router.post('/gameplay-session/status', async (req, res) => {
    const identity = getVerifiedIdentity(req);
    if (!identity) {
      res.status(401).json({error: 'Sign in first.'});
      return;
    }
    try {
      const session = await loadGameplaySession(identity.accountId, 'game-authority');
      res.json({
        session:
          session?.state === 'active' && session.expiresAt > Date.now()
            ? {...session, publicKey: identity.publicKey}
            : null,
      });
    } catch {
      res.status(503).json({error: 'Gameplay authorization is unavailable.'});
    }
  });
  const prepareAuthority = async (req: Request, res: import('express').Response, revoke: boolean) => {
    const identity = getVerifiedIdentity(req),
      config = nearConfiguration();
    if (!identity || !config.liveEnabled || !config.contractId) {
      res.status(403).json({error: 'Sign in to Worldo first.'});
      return;
    }
    try {
      await assertNearRpcNetwork();
      const session = revoke
        ? await loadGameplaySession(identity.accountId, 'game-authority')
        : await prepareGameplaySession(identity.accountId, identity.publicKey);
      if (!session) throw new Error('No game-token authorization exists.');
      const access = await nearRpc<{nonce: number; block_hash: string; block_height: number; permission: unknown}>({
        request_type: 'view_access_key',
        finality: 'final',
        account_id: identity.accountId,
        public_key: identity.publicKey,
      });
      if (access.permission !== 'FullAccess') throw new Error('Authorize with the account owner key.');
      const signer = KeyPair.fromString(process.env.NEAR_ORACLE_PRIVATE_KEY as `ed25519:${string}`);
      let args: Record<string, unknown>;
      if (revoke) {
        if (!options.freezeGameAuthority) throw new Error('Gameplay authorization cannot be closed on this server.');
        // Freeze in the same world CAS as player actions. A signed nonce cutoff
        // preserves all accepted work without allowing any new queued spending.
        const {lastAcceptedNonce} = await options.freezeGameAuthority(identity.accountId, session.authorizedAt);
        await saveGameAuthority({...session, publicKey: identity.publicKey, state: 'revoked'});
        const revocation = JSON.stringify({
          accountId: identity.accountId,
          contractId: config.contractId,
          network: config.network,
          authorizedAt: session.authorizedAt,
          lastAcceptedNonce,
          createdAt: Date.now(),
        });
        args = {revocation, signature: Buffer.from(signer.sign(Buffer.from(revocation)).signature).toString('base64')};
      } else {
        const authorization = JSON.stringify({
          accountId: identity.accountId,
          contractId: config.contractId,
          network: config.network,
          expiresAt: session.expiresAt,
          spendLimit: session.spendLimit,
          createdAt: session.createdAt,
        });
        args = {
          authorization,
          signature: Buffer.from(signer.sign(Buffer.from(authorization)).signature).toString('base64'),
        };
      }
      const method = revoke ? 'revoke_game' : 'authorize_game',
        prepared = prepareGameTransaction({
          accountId: identity.accountId,
          publicKey: identity.publicKey,
          contractId: config.contractId,
          method,
          args,
          deposit: '0',
          access,
        }),
        id = randomUUID();
      pendingActions.set(id, {
        ...prepared,
        session: sessionId(req),
        ownerAccountId: identity.accountId,
        expiresAt: Date.now() + 300000,
        method,
        deposit: '0',
        gameplayPublicKey: identity.publicKey,
        gameplayOperation: revoke ? 'remove' : 'add',
      });
      res.json({
        id,
        payload: [...prepared.bytes],
        kind: prepared.kind,
        network: config.network,
        publicKey: identity.publicKey,
        signingMode: identity.authMethod || 'near-auth',
        session,
        gasSponsored: true,
        ...(prepared.kind === 'delegateAction' ? {maxBlockHeight: prepared.delegate.maxBlockHeight.toString()} : {}),
      });
    } catch (error) {
      res.status(422).json({error: error instanceof Error ? error.message : 'Gameplay authorization is unavailable.'});
    }
  };
  router.post('/gameplay-session/prepare', (req, res) => prepareAuthority(req, res, false));
  router.post('/gameplay-session/revoke-prepare', (req, res) => prepareAuthority(req, res, true));
  router.post('/gameplay-session/confirm', async (req, res) => {
    const identity = getVerifiedIdentity(req);
    if (!identity) {
      res.status(401).json({error: 'Sign in first.'});
      return;
    }
    try {
      res.json(await confirmAuthority(identity));
    } catch (error) {
      res
        .status(422)
        .json({
          error: error instanceof Error ? error.message : 'Could not confirm gameplay authorization.',
          ...(error instanceof MissingGameplayAuthority ? {finalizedBlockHeight: error.finalizedBlockHeight} : {}),
        });
    }
  });
  router.post('/relay', async (req, res) => {
    const identity = getVerifiedIdentity(req),
      id = req.body?.id,
      pending = pendingActions.get(id);
    if (
      !identity ||
      !nearConfiguration().liveEnabled ||
      !nearConfiguration().relayerConfigured ||
      !pending ||
      pending.session !== sessionId(req) ||
      pending.ownerAccountId !== identity.accountId ||
      pending.expiresAt < Date.now()
    ) {
      res.status(403).json({error: 'Transaction authorization expired or is unavailable.'});
      return;
    }
    pendingActions.delete(id);
    // This describes the owner/delegate game transaction, not the MPC signing
    // service call. Once submission is attempted, a transport error cannot prove
    // it was unsent. Unknown/consumed ids above deliberately make no such claim.
    let submitted = false;
    try {
      await assertNearRpcNetwork();
      await assertTransactionReady(pending.method);
      if (typeof req.body.token !== 'string' || req.body.token.length > 30000)
        throw new Error('Invalid authorization.');
      const {payload} = await verifyAuthToken(req.body.token);
      if (
        payload.sub !== identity.authSubject ||
        payload.azp !== nearAuthConfiguration().clientId ||
        !Array.isArray(payload.fatxn) ||
        payload.fatxn.some(n => !Number.isInteger(n) || n < 0 || n > 255)
      )
        throw new Error('Invalid authorization.');
      const bytes = Buffer.from(payload.fatxn);
      if (bytes.length !== pending.bytes.length || !timingSafeEqual(bytes, pending.bytes))
        throw new Error('Transaction does not match the approved action.');
      let outcome: Record<string, unknown>;
      const ensureReviewedFee = async () => {
        if (pending.kind !== 'transaction') return;
        const price = await nearRpc<{gas_price: string}>({block_id: null}, 'gas_price');
        if (
          !pending.reviewedFeeCeiling ||
          BigInt(actionCost(pending.method, pending.deposit, price.gas_price).feeEstimateYocto) >
            BigInt(pending.reviewedFeeCeiling)
        )
          throw new Error('Network costs changed. Review a new transaction.');
      };
      await ensureReviewedFee();
      if (pending.kind === 'delegateAction') assertSponsoredDelegate(pending.delegate);
      if (localRelayerConfigured()) {
        const signature = await relayAuthorizedSignature(req.body.token, [...bytes], pending.method);
        await ensureReviewedFee();
        submitted = true;
        outcome =
          pending.kind === 'transaction'
            ? await submitUserTransaction(pending.transaction, signature)
            : await submitSponsoredDelegate(pending.delegate, signature);
      } else {
        const route = pending.kind === 'transaction' ? 'sign-tx' : 'sign-delegate-tx';
        const url = new URL(`${process.env.NEAR_AUTH_RELAYER_URL!.replace(/\/$/, '')}/${route}`);
        if (url.protocol !== 'https:') throw new Error('Relayer must use HTTPS.');
        // The external delegate endpoint both signs and submits. The ordinary
        // transaction endpoint only obtains a signature; submission happens below.
        if (pending.kind === 'delegateAction') submitted = true;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.NEAR_AUTH_RELAYER_TOKEN
              ? {Authorization: `Bearer ${process.env.NEAR_AUTH_RELAYER_TOKEN}`}
              : {}),
          },
          body: JSON.stringify({
            guard_id: nearAuthConfiguration().guardId,
            verify_payload: req.body.token,
            sign_payload: [...bytes],
            algorithm: 'eddsa',
            ...(pending.kind === 'delegateAction' ? {receiver_id: identity.accountId} : {}),
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw new Error('The signing service is temporarily unavailable.');
        const result = (await response.json()) as {result?: Record<string, unknown>};
        if (!result.result) throw new Error('The signing service did not return an execution result.');
        if (pending.kind === 'transaction') {
          const signature = (result.result.status as {SuccessValue?: string})?.SuccessValue;
          if (!signature || !executionSucceeded(result.result))
            throw new Error('The signing service did not return a successful signature.');
          await ensureReviewedFee();
          submitted = true;
          outcome = await submitUserTransaction(pending.transaction, signature);
        } else outcome = result.result;
      }
      const hash = (outcome.transaction as {hash?: string})?.hash;
      if (!hash) throw new Error('Transaction confirmation is unavailable. Check your account before trying again.');
      const sender = (outcome.transaction as {signer_id?: string}).signer_id;
      if (sender) outcome = await nearRpc({tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL'}, 'tx');
      if (!executionSucceeded(outcome)) {
        res
          .status(422)
          .json({
            error: `The game transaction failed. Receipt: ${transactionExplorerUrl(hash)}`,
            hash,
            explorerUrl: transactionExplorerUrl(hash),
          });
        return;
      }
      if (pending.gameplayPublicKey) await confirmAuthority(identity);
      res.json({
        hash,
        explorerUrl: transactionExplorerUrl(hash),
        outcome,
        gasSponsored: pending.kind === 'delegateAction',
        attachedDepositPayer: pending.kind === 'delegateAction' ? 'sponsor' : 'player',
      });
    } catch {
      res
        .status(422)
        .json({error: 'The transaction could not be confirmed. Check your account before trying again.', submitted});
    }
  });
  return router;
}
