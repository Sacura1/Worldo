import {readBroadcast, writeBroadcast, broadcastCanBeReplaced} from './city-chain-journal';
import {
  reserveTestnetBudget,
  releaseTestnetBudget,
  claimTestnetWallet,
  finishTestnetWallet,
  releaseTestnetWallet,
} from './testnet-journal';
import {connect, keyStores, KeyPair} from 'near-api-js';
import {neon} from '@neondatabase/serverless';
import {
  actionCreators,
  createTransaction,
  Signature,
  SignedTransaction,
  encodeTransaction,
  encodeDelegateAction,
  type DelegateAction,
  type Transaction,
} from '@near-js/transactions';
import {KeyPair as SigningKey} from '@near-js/crypto';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {nearAuthConfiguration, nearNetworkConfiguration, assertNearRpcNetwork} from './near-config';
import {assertSponsoredDelegate} from './transaction-policy';
import {assertAccountReady, assertTransactionReady} from './production-readiness';

let lock = Promise.resolve();
/** Calls attach far more gas than they burn, and unused gas returns to the sponsor.
 * Budgeting by the attached amount made every batch look about 22 times dearer. */
const SPONSORED_CALL_GAS = 60_000_000_000_000n;
/** Pays only the storage of a throwaway test account. The sponsor pays its gas. */
const GUEST_ACCOUNT_YOCTO = 2_500_000_000_000_000_000_000n;
let initialize: Promise<void> | undefined;
export function localRelayerConfigured() {
  return Boolean(
    process.env.NEAR_RELAYER_ACCOUNT_ID &&
    process.env.NEAR_RELAYER_PRIVATE_KEY?.startsWith('ed25519:') &&
    process.env.NEAR_RELAYER_SIGN_DEPOSIT_YOCTO &&
    process.env.NEAR_RELAYER_DAILY_BUDGET_YOCTO &&
    (process.env.DATABASE_URL || nearNetworkConfiguration().testnet),
  );
}
async function reserveBudget(reserved: bigint) {
  const budget = BigInt(process.env.NEAR_RELAYER_DAILY_BUDGET_YOCTO || '0');
  if (reserved <= 0n || reserved > budget) throw new Error('The operation exceeds the relayer budget.');
  if (nearNetworkConfiguration().testnet) {
    await reserveTestnetBudget(reserved, budget);
    return;
  }
  const sql = neon(process.env.DATABASE_URL!);
  initialize ??=
    sql`CREATE TABLE IF NOT EXISTS worldo_relayer_budget (day date PRIMARY KEY, reserved numeric(40,0) NOT NULL)`
      .then(() => undefined)
      .catch(error => {
        initialize = undefined;
        throw error;
      });
  await initialize;
  const rows =
    await sql`INSERT INTO worldo_relayer_budget(day,reserved) VALUES(CURRENT_DATE,${reserved.toString()}::numeric) ON CONFLICT(day) DO UPDATE SET reserved=worldo_relayer_budget.reserved+EXCLUDED.reserved WHERE worldo_relayer_budget.reserved+EXCLUDED.reserved<=${budget.toString()}::numeric RETURNING reserved`;
  if (!rows.length) throw new Error('The signing budget is exhausted for today.');
}
async function releaseBudget(amount: bigint) {
  if (amount <= 0n) return;
  if (nearNetworkConfiguration().testnet) {
    await releaseTestnetBudget(amount);
    return;
  }
  const sql = neon(process.env.DATABASE_URL!);
  await sql`UPDATE worldo_relayer_budget SET reserved=GREATEST(reserved-${amount.toString()}::numeric,0) WHERE day=CURRENT_DATE`;
}
function tokensBurnt(result: Record<string, unknown>): bigint {
  const outcomes = [
    result.transaction_outcome,
    ...(Array.isArray(result.receipts_outcome) ? result.receipts_outcome : []),
  ] as ({outcome?: {tokens_burnt?: string}} | undefined)[];
  return outcomes.reduce((total, item) => total + BigInt(item?.outcome?.tokens_burnt ?? '0'), 0n);
}
async function gasReservation(gas: bigint, safetyMultiplier = 2n) {
  const response = await fetch(nearNetworkConfiguration().rpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'sponsor-gas', method: 'gas_price', params: {block_id: null}}),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json()) as {result?: {gas_price: string}; error?: unknown};
  if (!response.ok || body.error || !body.result?.gas_price || !/^\d+$/.test(body.result.gas_price))
    throw new Error('The sponsor gas allowance is unavailable.');
  // Reserve twice the current price plus receipt overhead. This is a budget
  // reservation, not a promise that future protocol gas prices are fixed.
  return (gas + 5_000_000_000_000n) * BigInt(body.result.gas_price) * safetyMultiplier;
}
function mpcSignature(signaturePayload: string): Uint8Array {
  const payload = JSON.parse(Buffer.from(signaturePayload, 'base64').toString()) as {signature?: number[]};
  if (
    !Array.isArray(payload.signature) ||
    payload.signature.length !== 64 ||
    payload.signature.some(n => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw new Error('Invalid MPC signature.');
  return Uint8Array.from(payload.signature);
}
export function assembleUserSignedTransaction(transaction: Transaction, signaturePayload: string) {
  const signature = mpcSignature(signaturePayload);
  if (!transaction.publicKey.verify(createHash('sha256').update(encodeTransaction(transaction)).digest(), signature))
    throw new Error('The signature does not match the player transaction.');
  return new SignedTransaction({transaction, signature: new Signature({keyType: 0, data: signature})});
}
/** Classify the actual signed receiver and method, not an API-provided label. */
function readinessMethod(transaction: {
  receiverId: string;
  actions: {enum?: string; functionCall?: {methodName: string}}[];
}): string {
  const call =
    transaction.actions.length === 1 && transaction.actions[0].enum === 'functionCall'
      ? transaction.actions[0].functionCall
      : undefined;
  if (
    call &&
    transaction.receiverId === process.env.NEAR_CONTRACT_ID &&
    ['authorize_game', 'revoke_game'].includes(call.methodName)
  )
    return call.methodName;
  if (call && transaction.receiverId === nearNetworkConfiguration().wrappedToken && call.methodName === 'near_withdraw')
    return 'unwrap';
  return 'gameplay';
}
/** Only the player's signature authorizes this ordinary transaction. The
 * protocol charges its signer (the player) the deposit and network gas. */
export async function submitUserTransaction(
  transaction: Transaction,
  signaturePayload: string,
): Promise<Record<string, unknown>> {
  await assertTransactionReady(readinessMethod(transaction));
  const signed = assembleUserSignedTransaction(transaction, signaturePayload);
  await assertNearRpcNetwork();
  const response = await fetch(nearNetworkConfiguration().rpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'player-transaction',
      method: 'send_tx',
      params: {signed_tx_base64: Buffer.from(encodeTransaction(signed)).toString('base64'), wait_until: 'FINAL'},
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = (await response.json()) as {result?: Record<string, unknown>; error?: unknown};
  if (!response.ok || body.error || !body.result) throw new Error('The player transaction could not be confirmed.');
  return body.result;
}
/** Caller must already verify identity, exact transaction bytes and method policy. */
export async function relayAuthorizedSignature(token: string, bytes: number[], method = 'gameplay'): Promise<string> {
  await assertTransactionReady(method);
  const previous = lock;
  let unlock!: () => void;
  lock = new Promise<void>(resolve => {
    unlock = resolve;
  });
  await previous;
  try {
    if (!localRelayerConfigured()) throw new Error('The signing relayer is not configured.');
    await assertNearRpcNetwork();
    const deposit = BigInt(process.env.NEAR_RELAYER_SIGN_DEPOSIT_YOCTO!);
    if (deposit < 0n) throw new Error('The relayer has no signing budget.');
    // Reserve the signing service's deposit and gas separately from the user's
    // eventual game deposit. Reservation survives restart and is not refunded.
    const reserved = deposit + (await gasReservation(300_000_000_000_000n));
    await reserveBudget(reserved);
    const keyStore = new keyStores.InMemoryKeyStore();
    const key = KeyPair.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`);
    await keyStore.setKey(nearNetworkConfiguration().network, process.env.NEAR_RELAYER_ACCOUNT_ID!, key);
    const near = await connect({
      networkId: nearNetworkConfiguration().network,
      nodeUrl: nearNetworkConfiguration().rpcUrl,
      keyStore,
    });
    const account = await near.account(process.env.NEAR_RELAYER_ACCOUNT_ID!);
    const result = await account.functionCall({
      contractId: nearNetworkConfiguration().authContract,
      methodName: 'sign',
      args: {guard_id: nearAuthConfiguration().guardId, verify_payload: token, sign_payload: bytes, algorithm: 'eddsa'},
      gas: 300_000_000_000_000n,
      attachedDeposit: deposit,
    });
    const confirmation = await fetch(nearNetworkConfiguration().rpcUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'sign-final',
        method: 'tx',
        params: {
          tx_hash: result.transaction.hash,
          sender_account_id: process.env.NEAR_RELAYER_ACCOUNT_ID,
          wait_until: 'FINAL',
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const final = (await confirmation.json()) as {result?: {status?: {SuccessValue?: string}}; error?: unknown};
    if (!confirmation.ok || final.error || !final.result?.status?.SuccessValue)
      throw new Error('The NEAR Auth contract did not return a finalized signature.');
    return final.result.status.SuccessValue;
  } finally {
    unlock();
  }
}
/** One sponsored implicit account per verified social identity. Native NEAR is
 * only onboarding gas/storage; Worldo game coins are a separate fixed ledger. */
export async function provisionNearWallet(accountId: string) {
  await assertAccountReady();
  if (!localRelayerConfigured() || !/^[a-f0-9]{64}$/.test(accountId))
    throw new Error('Account preparation is unavailable.');
  const previous = lock;
  let unlock!: () => void;
  lock = new Promise<void>(resolve => {
    unlock = resolve;
  });
  await previous;
  let claimed = false,
    broadcastStarted = false;
  try {
    await assertNearRpcNetwork();
    const config = nearNetworkConfiguration();
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 'account-setup', method, params}),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error('NEAR is unavailable.');
      return response.json() as Promise<{result?: Record<string, unknown>; error?: unknown}>;
    };
    const status = await rpc('query', {request_type: 'view_account', finality: 'final', account_id: accountId});
    if (status.result) return {accountId, ready: true, hashes: [] as string[]};
    if (!JSON.stringify(status.error).includes('UNKNOWN_ACCOUNT'))
      throw new Error('Account status could not be verified.');
    const sql = config.testnet ? null : neon(process.env.DATABASE_URL!);
    if (sql)
      await sql`CREATE TABLE IF NOT EXISTS worldo_wallet_setup(account_id text PRIMARY KEY,state text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`;
    claimed = config.testnet
      ? await claimTestnetWallet(accountId)
      : Boolean(
          (
            await sql!`INSERT INTO worldo_wallet_setup(account_id,state) VALUES(${accountId},'preparing') ON CONFLICT(account_id) DO NOTHING RETURNING account_id`
          ).length,
        );
    if (!claimed) throw new Error('Account setup is awaiting confirmation.');
    const amount = 30_000_000_000_000_000_000_000n;
    await reserveBudget(amount + (await gasReservation(30_000_000_000_000n)));
    const store = new keyStores.InMemoryKeyStore();
    await store.setKey(
      config.network,
      process.env.NEAR_RELAYER_ACCOUNT_ID!,
      KeyPair.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`),
    );
    const near = await connect({networkId: config.network, nodeUrl: config.rpcUrl, keyStore: store});
    broadcastStarted = true;
    const result = await (await near.account(process.env.NEAR_RELAYER_ACCOUNT_ID!)).sendMoney(accountId, amount);
    const final = await rpc('tx', {
      tx_hash: result.transaction.hash,
      sender_account_id: process.env.NEAR_RELAYER_ACCOUNT_ID,
      wait_until: 'FINAL',
    });
    if (final.error || !final.result?.status || !('SuccessValue' in (final.result.status as object)))
      throw new Error('Account setup is awaiting confirmation.');
    if (config.testnet) await finishTestnetWallet(accountId);
    else await sql!`UPDATE worldo_wallet_setup SET state='ready' WHERE account_id=${accountId}`;
    return {accountId, ready: true, hashes: [result.transaction.hash]};
  } catch (error) {
    if (claimed && !broadcastStarted) {
      if (nearNetworkConfiguration().testnet) await releaseTestnetWallet(accountId);
      else {
        const sql = neon(process.env.DATABASE_URL!);
        await sql`DELETE FROM worldo_wallet_setup WHERE account_id=${accountId} AND state='preparing'`;
      }
    }
    throw error;
  } finally {
    unlock();
  }
}
/** Creates one throwaway testnet account for guest play. Mainnet never uses this. */
export async function fundGuestAccount(accountId: string) {
  const config = nearNetworkConfiguration();
  if (!config.testnet || !localRelayerConfigured() || !/^[a-f0-9]{64}$/.test(accountId))
    throw new Error('Guest accounts are unavailable.');
  const previous = lock;
  let unlock!: () => void;
  lock = new Promise<void>(resolve => {
    unlock = resolve;
  });
  await previous;
  try {
    await assertNearRpcNetwork();
    await reserveBudget(GUEST_ACCOUNT_YOCTO + (await gasReservation(5_000_000_000_000n, 1n)));
    const store = new keyStores.InMemoryKeyStore();
    await store.setKey(
      config.network,
      process.env.NEAR_RELAYER_ACCOUNT_ID!,
      KeyPair.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`),
    );
    const near = await connect({networkId: config.network, nodeUrl: config.rpcUrl, keyStore: store});
    const result = await (
      await near.account(process.env.NEAR_RELAYER_ACCOUNT_ID!)
    ).sendMoney(accountId, GUEST_ACCOUNT_YOCTO);
    return result.transaction.hash as string;
  } finally {
    unlock();
  }
}
/** Wrap the user's signed delegate action in the sponsor's transaction (NEP-366). */
export async function submitSponsoredDelegate(
  delegate: DelegateAction,
  signaturePayload: string,
  operationId?: string,
): Promise<Record<string, unknown>> {
  const attached = assertSponsoredDelegate(delegate);
  await assertTransactionReady(readinessMethod(delegate));
  const previous = lock;
  let unlock!: () => void;
  lock = new Promise<void>(resolve => {
    unlock = resolve;
  });
  await previous;
  try {
    if (!localRelayerConfigured()) throw new Error('The signing relayer is not configured.');
    await assertNearRpcNetwork();
    const signature = mpcSignature(signaturePayload);
    if (!delegate.publicKey.verify(createHash('sha256').update(encodeDelegateAction(delegate)).digest(), signature))
      throw new Error('The signature does not match the approved delegate.');
    const attachedGas = delegate.actions[0].functionCall!.gas,
      reserved =
        attached + (await gasReservation(attachedGas < SPONSORED_CALL_GAS ? attachedGas : SPONSORED_CALL_GAS, 1n));
    await reserveBudget(reserved);
    const pair = SigningKey.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`);
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(nearNetworkConfiguration().rpcUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 'worldo-relay', method, params}),
        signal: AbortSignal.timeout(60000),
      });
      const body = (await response.json()) as {result?: Record<string, unknown>; error?: unknown};
      if (!response.ok || body.error || !body.result)
        throw new Error('The sponsored transaction could not be confirmed.');
      return body.result;
    };
    const access = await rpc('query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: process.env.NEAR_RELAYER_ACCOUNT_ID,
      public_key: pair.getPublicKey().toString(),
    });
    const action = actionCreators.signedDelegate({
      delegateAction: delegate,
      signature: new Signature({keyType: 0, data: signature}),
    });
    // The wrapper receiver is the original sender. The signed delegate itself
    // names the game contract. Only gas is sponsored; the inner deposit is zero.
    const transaction = createTransaction(
      process.env.NEAR_RELAYER_ACCOUNT_ID!,
      pair.getPublicKey(),
      delegate.senderId,
      BigInt(access.nonce as number) + 1n,
      [action],
      bs58.decode(access.block_hash as string),
    );
    const signed = pair.sign(createHash('sha256').update(encodeTransaction(transaction)).digest());
    const envelope = new SignedTransaction({
      transaction,
      signature: new Signature({keyType: 0, data: signed.signature}),
    });
    const hash = bs58.encode(createHash('sha256').update(encodeTransaction(transaction)).digest());
    if (operationId) {
      const old = await readBroadcast(operationId);
      if (old && !broadcastCanBeReplaced(old)) throw new Error('Reconcile the existing broadcast before retrying.');
      const delegateMaxBlockHeight = Number(delegate.maxBlockHeight);
      if (!Number.isSafeInteger(delegateMaxBlockHeight)) throw new Error('Invalid delegate expiry height.');
      await writeBroadcast({
        operationId,
        transactionHash: hash,
        signerId: process.env.NEAR_RELAYER_ACCOUNT_ID!,
        state: 'broadcasting',
        createdAt: Date.now(),
        delegateMaxBlockHeight,
        signedTransactionBase64: Buffer.from(encodeTransaction(envelope)).toString('base64'),
      });
    }
    const result = await rpc('send_tx', {
      signed_tx_base64: Buffer.from(encodeTransaction(envelope)).toString('base64'),
      wait_until: 'FINAL',
    });
    await releaseBudget(reserved - tokensBurnt(result)).catch(() =>
      console.warn('The sponsor budget could not be adjusted.'),
    );
    if (operationId) {
      const status = result.status as Record<string, unknown> | undefined;
      const failed =
        Boolean(status && 'Failure' in status) ||
        (Array.isArray(result.receipts_outcome) &&
          result.receipts_outcome.some((r: any) => r.outcome?.status?.Failure));
      await writeBroadcast({
        operationId,
        transactionHash: hash,
        signerId: process.env.NEAR_RELAYER_ACCOUNT_ID!,
        state: failed ? 'failed' : 'confirmed',
        createdAt: Date.now(),
        confirmedAt: Date.now(),
      });
    }
    return result;
  } finally {
    unlock();
  }
}
