import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {KeyPair} from '@near-js/crypto';
import {actionCreators, buildDelegateAction, encodeTransaction} from '@near-js/transactions';
import bs58 from 'bs58';
import {ACTION_GAS, assertSponsoredDelegate, prepareGameTransaction} from '../server/transaction-policy';
import {assembleUserSignedTransaction, submitSponsoredDelegate} from '../server/relayer';
const player = KeyPair.fromRandom('ed25519'),
  other = KeyPair.fromRandom('ed25519');
const input = {
  accountId: 'player.testnet',
  publicKey: player.getPublicKey().toString(),
  contractId: 'worldo.testnet',
  args: {},
  access: {nonce: 10, block_height: 100, block_hash: bs58.encode(new Uint8Array(32))},
};
const delegate = (method: string, deposit = 0n, senderId = 'player.testnet', receiverId = 'worldo.testnet') =>
  buildDelegateAction({
    senderId,
    receiverId,
    publicKey: player.getPublicKey(),
    nonce: 11n,
    maxBlockHeight: 400n,
    actions: [actionCreators.functionCall(method, Buffer.from('{}'), ACTION_GAS, deposit)],
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('gas-only sponsorship', () => {
  it.each(['authorize_game', 'revoke_game'])('sponsors explicit %s without native token transfer authority', method => {
    const prepared = prepareGameTransaction({...input, method, deposit: '0'});
    expect(prepared.kind).toBe('delegateAction');
    if (prepared.kind === 'delegateAction')
      expect(assertSponsoredDelegate(prepared.delegate, 'worldo.testnet')).toBe(0n);
  });
  it('allows background batches only from the configured oracle', () => {
    vi.stubEnv('NEAR_ORACLE_ACCOUNT_ID', 'oracle.testnet');
    expect(assertSponsoredDelegate(delegate('apply_batch', 0n, 'oracle.testnet'), 'worldo.testnet')).toBe(0n);
    expect(() => assertSponsoredDelegate(delegate('apply_batch'), 'worldo.testnet')).toThrow('cannot use');
  });
  it.each([1n, 10n ** 24n])('rejects attached native funds at the sponsor boundary (%s)', async amount => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(submitSponsoredDelegate(delegate('authorize_game', amount), 'invalid')).rejects.toThrow(
      'zero-deposit',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects another contract and unrestricted token transfers', () => {
    expect(() =>
      assertSponsoredDelegate(delegate('authorize_game', 0n, 'player.testnet', 'evil.testnet'), 'worldo.testnet'),
    ).toThrow('cannot use');
    expect(() => assertSponsoredDelegate(delegate('mt_transfer'), 'worldo.testnet')).toThrow('cannot use');
  });
  it('rejects multiple actions even when both methods are individually permitted', () => {
    const d = delegate('authorize_game');
    d.actions.push(actionCreators.functionCall('revoke_game', Buffer.from('{}'), 1n, 0n));
    expect(() => assertSponsoredDelegate(d, 'worldo.testnet')).toThrow('single');
  });
  it('verifies ordinary owner transactions against the actual owner key', () => {
    const prepared = prepareGameTransaction({...input, method: 'mt_transfer', deposit: '1'});
    if (prepared.kind !== 'transaction') throw Error('Owner transfer must not be sponsored');
    const digest = createHash('sha256').update(encodeTransaction(prepared.transaction)).digest();
    const payload = (key: typeof player) =>
      Buffer.from(JSON.stringify({signature: [...key.sign(digest).signature]})).toString('base64');
    expect(assembleUserSignedTransaction(prepared.transaction, payload(player)).transaction.signerId).toBe(
      input.accountId,
    );
    expect(() => assembleUserSignedTransaction(prepared.transaction, payload(other))).toThrow('does not match');
  });
});
