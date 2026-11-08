import {createHash} from 'node:crypto';
import {KeyPair} from '@near-js/crypto';
import {prepareGameTransaction} from './transaction-policy';
import {fundGuestAccount, submitSponsoredDelegate} from './relayer';
import {prepareGameplaySession} from './gameplay-sessions';

/** Guest play is the fast way to try Worldo with no sign-up. Each guest gets a real
 * throwaway testnet account, so their trades settle on NEAR like anyone else's. The
 * key signs one bounded grant and is then discarded. It is never stored anywhere. */
export interface GuestAccount {
  accountId: string;
  publicKey: string;
}
type Chain = {
  nearRpc: <T>(params: Record<string, unknown>, method?: string) => Promise<T>;
  executionSucceeded: (outcome: Record<string, unknown>) => boolean;
  confirm: (account: GuestAccount) => Promise<unknown>;
};
const READY_GUESTS = 3;
const ready: GuestAccount[] = [];
let filling: Promise<void> | undefined;

type AccessKey = {nonce: number; block_hash: string; block_height: number};
/** A new account takes a moment to reach final state, and the node reports its key
 * as missing until then. Asking too early is normal, so this simply waits. */
async function readAccessKey(nearRpc: Chain['nearRpc'], accountId: string, publicKey: string): Promise<AccessKey> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const access = await nearRpc<AccessKey>({
      request_type: 'view_access_key',
      finality: 'final',
      account_id: accountId,
      public_key: publicKey,
    }).catch(() => null);
    if (access && Number.isSafeInteger(access.nonce)) return access;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Guest account is not ready.');
}
async function createGuest({nearRpc, executionSucceeded, confirm}: Chain): Promise<GuestAccount> {
  const pair = KeyPair.fromRandom('ed25519'),
    publicKey = pair.getPublicKey().toString(),
    accountId = Buffer.from(pair.getPublicKey().data).toString('hex'),
    contractId = process.env.NEAR_CONTRACT_ID!;
  await fundGuestAccount(accountId);
  const access = await readAccessKey(nearRpc, accountId, publicKey);
  const session = await prepareGameplaySession(accountId, publicKey),
    oracle = KeyPair.fromString(process.env.NEAR_ORACLE_PRIVATE_KEY as `ed25519:${string}`);
  const authorization = JSON.stringify({
    accountId,
    contractId,
    network: session.network,
    expiresAt: session.expiresAt,
    spendLimit: session.spendLimit,
    createdAt: session.createdAt,
  });
  const args = {
    authorization,
    signature: Buffer.from(oracle.sign(Buffer.from(authorization)).signature).toString('base64'),
  };
  const prepared = prepareGameTransaction({
    accountId,
    publicKey,
    contractId,
    method: 'authorize_game',
    args,
    deposit: '0',
    access,
  });
  if (prepared.kind !== 'delegateAction') throw new Error('Guest setup must be sponsored.');
  const signature = pair.sign(createHash('sha256').update(prepared.bytes).digest()).signature;
  const outcome = await submitSponsoredDelegate(
    prepared.delegate,
    Buffer.from(JSON.stringify({signature: [...signature]})).toString('base64'),
  );
  if (!executionSucceeded(outcome)) throw new Error('Guest setup failed.');
  const guest = {accountId, publicKey};
  await confirm(guest);
  return guest;
}
/** Keeps a couple of accounts ready so pressing Play feels instant. */
export function refillGuests(chain: Chain) {
  filling ??= (async () => {
    while (ready.length < READY_GUESTS) ready.push(await createGuest(chain));
  })()
    .catch(() => console.warn('Guest accounts are refilling later.'))
    .finally(() => {
      filling = undefined;
    });
  return filling;
}
export async function takeGuest(chain: Chain): Promise<GuestAccount> {
  const guest = ready.shift() ?? (await createGuest(chain));
  void refillGuests(chain);
  return guest;
}
