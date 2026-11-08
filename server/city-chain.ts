import {createHash} from 'node:crypto';
import {KeyPair} from '@near-js/crypto';
import type {SettlementPlan, SettlementBatch, ChainReceipt, CityId} from '../shared/game';
import {estimateWorldBatchLogBytes} from '../shared/batches';
import {nearRpc, viewContract, executionSucceeded} from './near';
import {nearNetworkConfiguration, transactionExplorerUrl, assertNearRpcNetwork} from './near-config';
import {chainSyncEnabled} from './chain-mode';
import {prepareGameTransaction} from './transaction-policy';
import {submitSponsoredDelegate} from './relayer';
import {readBroadcast, writeBroadcast, broadcastCanBeReplaced, type BroadcastAttempt} from './city-chain-journal';
import {serialized} from './mutex';
export {estimateWorldBatchLogBytes} from '../shared/batches';
export interface CityChainAccount {
  balances: Record<string, number>;
  nonce: number;
  registered: boolean;
}
/** The contract ran and said no. Network trouble never raises this. */
export class BatchRejectedError extends Error {}
const contractRefused = (outcome: Record<string, unknown>) =>
  /Smart contract panicked/.test(JSON.stringify(outcome.receipts_outcome ?? []) + JSON.stringify(outcome.status ?? {}));
export function cityAccounts(): Record<CityId, string> {
  return {
    refinery: process.env.NEAR_REFINERY_ACCOUNT || '',
    motor: process.env.NEAR_MOTOR_ACCOUNT || '',
    harbor: process.env.NEAR_HARBOR_ACCOUNT || '',
  };
}
function contract() {
  const id = process.env.NEAR_CONTRACT_ID;
  if (!id) throw new Error('The city contract is not configured.');
  return id;
}
export function getCityChainPlayer(accountId: string) {
  return viewContract<CityChainAccount | null>(contract(), 'account', {account_id: accountId});
}
export async function readCityChainWorld() {
  const accounts = cityAccounts();
  const [configuration, refinery, motor, harbor, starterPool] = await Promise.all([
    viewContract<Record<string, unknown>>(contract(), 'configuration', {}),
    getCityChainPlayer(accounts.refinery),
    getCityChainPlayer(accounts.motor),
    getCityChainPlayer(accounts.harbor),
    getCityChainPlayer(contract()),
  ]);
  return {configuration, cities: {refinery, motor, harbor}, starterPool};
}
export function validateSettlementPlan(plan: SettlementPlan) {
  if (!plan || !/^[A-Za-z0-9:_.-]{8,128}$/.test(plan.id) || !Number.isSafeInteger(plan.nonce) || plan.nonce < 1)
    throw new Error('Invalid settlement identity.');
  if (plan.transfers.length + plan.mints.length + plan.burns.length + (plan.stationEffects?.length || 0) > 128)
    throw new Error('Too many settlement effects.');
  for (const effect of [...plan.transfers, ...plan.mints, ...plan.burns])
    if (!Number.isSafeInteger(effect.amount) || effect.amount <= 0 || effect.amount > 1_000_000)
      throw new Error('Invalid integer settlement amount.');
  for (const effect of plan.stationEffects || [])
    if (!Number.isSafeInteger(effect.petrolDelta) || effect.petrolDelta === 0 || Math.abs(effect.petrolDelta) > 5000)
      throw new Error('Invalid station tank delta.');
  if (plan.mints.some(m => m.tokenId === 'coin') || plan.burns.some(b => b.tokenId === 'coin'))
    throw new Error('Gameplay cannot mint or burn coins.');
}
export function canonicalBatchJSON(batch: SettlementBatch) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return JSON.stringify(canonical(batch));
}
export interface AppliedBatch {
  id: string;
  sequence: number;
  batchHash: string;
  blockHeight: number;
  timestamp: number;
}
export function settlementBatchHash(batch: SettlementBatch) {
  return createHash('sha256').update(canonicalBatchJSON(batch)).digest('hex');
}
export function getBatchReceipt(batchId: string) {
  return viewContract<AppliedBatch | null>(contract(), 'batch_receipt', {id: batchId});
}
export async function reconcileWorldBatch(
  batch: SettlementBatch,
): Promise<{receipt: ChainReceipt | null; safeToAbort: boolean}> {
  let [applied, broadcast] = await Promise.all([getBatchReceipt(batch.id), readBroadcast(batch.id)]);
  const expectedHash = settlementBatchHash(batch),
    matches = (value: AppliedBatch) => value.batchHash === expectedHash && value.sequence === batch.sequence;
  if (applied && !matches(applied)) throw new Error('The on-chain batch does not match this outbox.');
  if (!broadcast) return {receipt: null, safeToAbort: !applied};
  const readApplied = async () => {
    applied = await getBatchReceipt(batch.id);
    if (applied && !matches(applied)) throw new Error('The on-chain batch does not match this outbox.');
    return applied;
  };
  const inspect = async (attempt: BroadcastAttempt, outcome: Record<string, unknown>): Promise<ChainReceipt | null> => {
    const transaction = outcome.transaction as {hash?: string; signer_id?: string} | undefined;
    if (transaction?.hash !== attempt.transactionHash || transaction.signer_id !== attempt.signerId) return null;
    if (executionSucceeded(outcome)) {
      const confirmed = applied || (await readApplied());
      if (confirmed && matches(confirmed)) {
        if (attempt.transactionHash === broadcast!.transactionHash) {
          await writeBroadcast({...broadcast!, state: 'confirmed', confirmedAt: confirmed.timestamp});
          broadcast = {...broadcast!, state: 'confirmed', confirmedAt: confirmed.timestamp};
        }
        return {
          transactionHash: attempt.transactionHash,
          explorerUrl: transactionExplorerUrl(attempt.transactionHash),
          operationId: batch.id,
          confirmedAt: confirmed.timestamp,
        };
      }
    } else if (
      (outcome.status && typeof outcome.status === 'object' && 'Failure' in outcome.status) ||
      (Array.isArray(outcome.receipts_outcome) && outcome.receipts_outcome.some((r: any) => r.outcome?.status?.Failure))
    ) {
      if (attempt.transactionHash === broadcast!.transactionHash && broadcast!.state !== 'confirmed') {
        await writeBroadcast({...broadcast!, state: 'failed'});
        broadcast = {...broadcast!, state: 'failed'};
      }
    }
    return null;
  };
  if (broadcast.state !== 'failed') {
    let outcome: Record<string, unknown> | undefined;
    try {
      outcome = await nearRpc<Record<string, unknown>>(
        {tx_hash: broadcast.transactionHash, sender_account_id: broadcast.signerId, wait_until: 'FINAL'},
        'tx',
      );
    } catch {
      /* The first send may never have reached NEAR. */
    }
    if (outcome) {
      const receipt = await inspect(broadcast, outcome);
      if (receipt) return {receipt, safeToAbort: false};
    } else if (broadcast.state === 'broadcasting') {
      if (Number.isSafeInteger(broadcast.delegateMaxBlockHeight)) {
        // Use a FINAL block, not a node's optimistic head. Expiry allows a new
        // envelope for this same immutable batch, never dropping accepted effects.
        try {
          const finalBlock = await nearRpc<{header: {height: number}}>({finality: 'final'}, 'block');
          const height = finalBlock.header?.height;
          if (Number.isSafeInteger(height) && height > broadcast.delegateMaxBlockHeight!) {
            const expired = {...broadcast, state: 'expired' as const, finalizedExpiryHeight: height};
            await writeBroadcast(expired);
            broadcast = expired;
          }
        } catch {
          /* Without a verified final height, expiry is not established. */
        }
      }
      if (broadcast.state === 'broadcasting' && broadcast.signedTransactionBase64) {
        // Within its validity window, retransmit the exact signed envelope. This
        // does not reserve another fee or create a new transaction nonce.
        let replay: Record<string, unknown> | undefined;
        try {
          replay = await nearRpc<Record<string, unknown>>(
            {signed_tx_base64: broadcast.signedTransactionBase64, wait_until: 'FINAL'},
            'send_tx',
          );
        } catch {}
        if (replay) {
          const receipt = await inspect(broadcast, replay);
          if (receipt) return {receipt, safeToAbort: false};
        }
      }
    }
  }
  if (!applied) await readApplied();
  if (applied) {
    // An older envelope may have created a receipt just before its delegate
    // expired. The contract permits this batch only once, so a later attempt can
    // fail while the earlier one wins. Preserve and query the actual winner.
    for (const attempt of [...(broadcast.previousAttempts || [])].reverse()) {
      if (attempt.state === 'failed') continue;
      let outcome: Record<string, unknown> | undefined;
      try {
        outcome = await nearRpc<Record<string, unknown>>(
          {tx_hash: attempt.transactionHash, sender_account_id: attempt.signerId, wait_until: 'FINAL'},
          'tx',
        );
      } catch {}
      if (outcome) {
        const receipt = await inspect(attempt, outcome);
        if (receipt) return {receipt, safeToAbort: false};
      }
    }
    return {receipt: null, safeToAbort: false};
  }
  return {receipt: null, safeToAbort: broadcastCanBeReplaced(broadcast)};
}
export async function settleWorldBatch(batch: SettlementBatch): Promise<ChainReceipt> {
  if (!chainSyncEnabled() || !nearNetworkConfiguration().chainEnabled)
    throw new Error('Chain synchronization is disabled.');
  if (
    !Number.isSafeInteger(batch.sequence) ||
    batch.sequence !== batch.previousSequence + 1 ||
    !batch.plans.length ||
    batch.plans.length > 100
  )
    throw new Error('Invalid batch sequence.');
  for (const plan of batch.plans) validateSettlementPlan(plan);
  const effects = batch.plans.reduce(
    (n, p) => n + p.transfers.length + p.mints.length + p.burns.length + (p.stationEffects?.length || 0),
    0,
  );
  if (effects > 512) throw new Error('Batch exceeds its effect limit.');
  if (estimateWorldBatchLogBytes(batch) > 14000)
    throw new Error('Batch exceeds its event log budget. Split the outbox batch.');
  return serialized('city-world-batch', async () => {
    await assertNearRpcNetwork();
    const reconciled = await reconcileWorldBatch(batch);
    if (reconciled.receipt) return reconciled.receipt;
    if (!reconciled.safeToAbort) throw new Error('The previous batch broadcast is awaiting confirmation.');
    const hash = settlementBatchHash(batch),
      network = nearNetworkConfiguration().network,
      accounts = cityAccounts();
    const message = 'Worldo mayor batch\n' + contract() + '\n' + network + '\n' + batch.sequence + '\n' + hash;
    const mayor_approvals = (['refinery', 'motor', 'harbor'] as const).map(city => {
      const secret = process.env['NEAR_' + city.toUpperCase() + '_PRIVATE_KEY'];
      if (!secret) throw new Error('Configure each mayor signing key before enabling chain sync.');
      const pair = KeyPair.fromString(secret as `ed25519:${string}`);
      return {
        account_id: accounts[city],
        signature: Buffer.from(pair.sign(Buffer.from(message)).signature).toString('base64'),
      };
    });
    const signerId = process.env.NEAR_ORACLE_ACCOUNT_ID!,
      pair = KeyPair.fromString(process.env.NEAR_ORACLE_PRIVATE_KEY as `ed25519:${string}`);
    const access = await nearRpc<{nonce: number; block_hash: string; block_height: number}>({
      request_type: 'view_access_key',
      finality: 'final',
      account_id: signerId,
      public_key: pair.getPublicKey().toString(),
    });
    const prepared = prepareGameTransaction({
      accountId: signerId,
      publicKey: pair.getPublicKey().toString(),
      contractId: contract(),
      method: 'apply_batch',
      args: {batch: canonicalBatchJSON(batch), mayor_approvals},
      deposit: '0',
      access,
    });
    if (prepared.kind !== 'delegateAction') throw new Error('Background settlement must be sponsored.');
    const signature = pair.sign(createHash('sha256').update(prepared.bytes).digest()).signature;
    const outcome = await submitSponsoredDelegate(
      prepared.delegate,
      Buffer.from(JSON.stringify({signature: [...signature]})).toString('base64'),
      batch.id,
    );
    if (!executionSucceeded(outcome)) {
      if (contractRefused(outcome)) throw new BatchRejectedError('The contract refused this batch.');
      throw new Error('The background settlement failed. The outbox has been retained.');
    }
    const result = await reconcileWorldBatch(batch);
    if (!result.receipt) throw new Error('The background settlement is awaiting confirmation.');
    return result.receipt;
  });
}
export async function readCityChainLedger() {
  const before = await viewContract<number>(contract(), 'ledger_version', {});
  const accounts: Record<string, CityChainAccount> = {};
  for (let from = 0; ; from += 100) {
    const page = await viewContract<string[]>(contract(), 'accounts_page', {from_index: from, limit: 100});
    if (!page.length) break;
    await Promise.all(
      page.map(async id => {
        const value = await getCityChainPlayer(id);
        if (value) accounts[id] = value;
      }),
    );
    if (page.length < 100) break;
  }
  const stations: Record<string, {owner_id: string; petrol: number} | null> = {};
  await Promise.all(
    ['refinery', 'motor', 'harbor'].flatMap(city =>
      [1, 2].map(async slot => {
        const id = 'station:' + city + ':' + slot;
        stations[id] = await viewContract(contract(), 'station_tank', {station_id: id});
      }),
    ),
  );
  const after = await viewContract<number>(contract(), 'ledger_version', {});
  if (before !== after) throw new Error('The on-chain ledger changed during reconciliation. Retry the read.');
  return {revision: after, accounts, stations};
}
