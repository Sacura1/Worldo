import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {KeyPair} from '@near-js/crypto';
import {decodeSignedDelegate} from './helpers/delegate';

const relayer = vi.hoisted(() => ({fundGuestAccount: vi.fn(), submitSponsoredDelegate: vi.fn()}));
vi.mock('../server/relayer', () => relayer);
import {refillGuests, takeGuest} from '../server/guest-accounts';

const chain = () => ({
  nearRpc: vi.fn(async () => ({nonce: 7, block_hash: '11111111111111111111111111111111', block_height: 1000})) as never,
  executionSucceeded: vi.fn(() => true),
  confirm: vi.fn(async () => undefined),
});

beforeEach(() => {
  process.env.NEAR_CONTRACT_ID = 'worldo.testnet';
  process.env.NEAR_NETWORK = 'testnet';
  process.env.NEAR_ORACLE_PRIVATE_KEY = KeyPair.fromRandom('ed25519').toString();
  relayer.fundGuestAccount.mockReset().mockResolvedValue('funding-hash');
  relayer.submitSponsoredDelegate.mockReset().mockResolvedValue({status: {SuccessValue: ''}});
});
afterEach(() => {
  delete process.env.NEAR_CONTRACT_ID;
  delete process.env.NEAR_ORACLE_PRIVATE_KEY;
});

describe('guest accounts', () => {
  it('creates a real account, grants it a bounded permission, and keeps no key', async () => {
    const dependencies = chain();
    const guest = await takeGuest(dependencies);
    expect(Object.keys(guest).sort()).toEqual(['accountId', 'publicKey']);
    expect(guest.accountId).toMatch(/^[a-f0-9]{64}$/);
    expect(relayer.fundGuestAccount).toHaveBeenCalledWith(guest.accountId);
    expect(dependencies.confirm).toHaveBeenCalledWith(guest);
    const {delegate} = decodeSignedDelegate(relayer.submitSponsoredDelegate.mock.calls[0]);
    expect(delegate.senderId).toBe(guest.accountId);
    expect(delegate.receiverId).toBe('worldo.testnet');
    expect(delegate.actions[0].functionCall?.methodName).toBe('authorize_game');
    expect(delegate.actions[0].functionCall?.deposit).toBe(0n);
    const args = JSON.parse(Buffer.from(delegate.actions[0].functionCall!.args).toString());
    expect(JSON.parse(args.authorization)).toMatchObject({
      accountId: guest.accountId,
      contractId: 'worldo.testnet',
      network: 'testnet',
    });
    await refillGuests(dependencies);
  });

  it('refuses to hand out an account whose setup failed', async () => {
    const failing = {...chain(), executionSucceeded: vi.fn(() => false)};
    // Earlier tests may have left prepared accounts. Use those up first.
    for (let spare = 0; spare < 3; spare++) await takeGuest(failing).catch(() => undefined);
    await expect(takeGuest(failing)).rejects.toThrow('Guest setup failed.');
  });

  it('prepares accounts ahead of time so entry is quick', async () => {
    const dependencies = chain();
    await refillGuests(dependencies);
    const calls = relayer.fundGuestAccount.mock.calls.length;
    await takeGuest(dependencies);
    expect(relayer.fundGuestAccount.mock.calls.length).toBeGreaterThanOrEqual(calls);
    await refillGuests(dependencies);
  });
});
