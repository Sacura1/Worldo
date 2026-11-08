import {nearNetworkConfiguration} from './near-config';
import {
  actionCreators,
  buildDelegateAction,
  createTransaction,
  encodeDelegateAction,
  encodeTransaction,
  type DelegateAction,
} from '@near-js/transactions';
import {PublicKey} from '@near-js/crypto';
import bs58 from 'bs58';

export const ACTION_GAS = 250_000_000_000_000n;
export function transactionKind(method: string, deposit: string) {
  // NEP-366 charges the OUTER signer for deposits as well as gas. A player's
  // registration/deposit must therefore be an ordinary player-signed transaction.
  return ['authorize_game', 'revoke_game', 'apply_batch'].includes(method) && BigInt(deposit) === 0n
    ? ('delegateAction' as const)
    : ('transaction' as const);
}
export function actionCost(method: string, deposit: string, gasPrice: string) {
  const kind = transactionKind(method, deposit),
    sponsored = kind === 'delegateAction';
  if (!/^\d+$/.test(gasPrice) || BigInt(gasPrice) <= 0n) throw new Error('Network gas price is unavailable.');
  return {
    kind,
    gasSponsored: sponsored,
    attachedDepositPayer: sponsored ? ('sponsor' as const) : ('player' as const),
    attachedDepositYocto: deposit,
    gas: ACTION_GAS.toString(),
    gasPriceYocto: gasPrice,
    feeEstimateYocto: ((ACTION_GAS + 5_000_000_000_000n) * BigInt(gasPrice)).toString(),
    estimatedAt: Date.now(),
  };
}
export function checkReviewedFee(review: unknown, current: ReturnType<typeof actionCost>): string | undefined {
  if (current.gasSponsored) return undefined;
  const approved = review as {feeEstimateYocto?: unknown; estimatedAt?: unknown} | null;
  if (
    !approved ||
    typeof approved.feeEstimateYocto !== 'string' ||
    !/^\d{1,30}$/.test(approved.feeEstimateYocto) ||
    typeof approved.estimatedAt !== 'number' ||
    approved.estimatedAt > Date.now() + 5000 ||
    Date.now() - approved.estimatedAt > 120000
  )
    throw new Error('Review a fresh network fee estimate before signing.');
  if (BigInt(current.feeEstimateYocto) > BigInt(approved.feeEstimateYocto))
    throw new Error('The network fee estimate increased. Review the updated cost before signing.');
  return approved.feeEstimateYocto;
}
export function prepareGameTransaction(input: {
  accountId: string;
  publicKey: string;
  contractId: string;
  method: string;
  args: unknown;
  deposit: string;
  access: {nonce: number; block_height: number; block_hash: string};
}) {
  const {accountId, publicKey, contractId, method, args, deposit, access} = input;
  const receiverId = method === 'unwrap' ? nearNetworkConfiguration().wrappedToken : contractId,
    callMethod = method === 'unwrap' ? 'near_withdraw' : method;
  const key = PublicKey.fromString(publicKey),
    nonce = BigInt(access.nonce) + 1n;
  const actions = [
    actionCreators.functionCall(callMethod, Buffer.from(JSON.stringify(args)), ACTION_GAS, BigInt(deposit)),
  ];
  if (transactionKind(method, deposit) === 'transaction') {
    const transaction = createTransaction(accountId, key, receiverId, nonce, actions, bs58.decode(access.block_hash));
    return {
      kind: 'transaction' as const,
      transaction,
      bytes: Buffer.from(encodeTransaction(transaction)),
      receiverId,
      nonce: nonce.toString(),
    };
  }
  const delegate = buildDelegateAction({
    senderId: accountId,
    receiverId,
    publicKey: key,
    nonce,
    maxBlockHeight: BigInt(access.block_height) + 300n,
    actions,
  });
  assertSponsoredDelegate(delegate, contractId);
  return {
    kind: 'delegateAction' as const,
    delegate,
    bytes: Buffer.from(encodeDelegateAction(delegate)),
    receiverId,
    nonce: nonce.toString(),
  };
}

/** Defense at the actual sponsor boundary, independent of API preparation. */
export function assertSponsoredDelegate(delegate: DelegateAction, contractId = process.env.NEAR_CONTRACT_ID): bigint {
  const action = delegate.actions[0],
    call = action?.functionCall;
  if (
    delegate.actions.length !== 1 ||
    action?.enum !== 'functionCall' ||
    !call ||
    call.deposit !== 0n ||
    call.gas > ACTION_GAS ||
    call.gas <= 0n
  )
    throw new Error('Only a single zero-deposit game call can be sponsored.');
  if (
    delegate.receiverId !== contractId ||
    !(
      ['authorize_game', 'revoke_game'].includes(call.methodName) ||
      (call.methodName === 'apply_batch' && delegate.senderId === process.env.NEAR_ORACLE_ACCOUNT_ID)
    )
  )
    throw new Error('This method cannot use the gameplay sponsor.');
  return 0n;
}
