import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
import type {SettlementBatch} from '../shared/game';
const mock = vi.hoisted(() => ({view: vi.fn(), rpc: vi.fn(), read: vi.fn(), write: vi.fn()}));
vi.mock('../server/near', () => ({
  nearRpc: mock.rpc,
  viewContract: mock.view,
  executionSucceeded: (outcome: any) =>
    Boolean(outcome.status && 'SuccessValue' in outcome.status) &&
    !(outcome.receipts_outcome || []).some((r: any) => r.outcome?.status?.Failure),
}));
vi.mock('../server/city-chain-journal', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/city-chain-journal')>()),
  readBroadcast: mock.read,
  writeBroadcast: mock.write,
}));
vi.mock('../server/relayer', () => ({submitSponsoredDelegate: vi.fn()}));
import {reconcileWorldBatch, settlementBatchHash} from '../server/city-chain';
const batch: SettlementBatch = {
  id: 'batch-recovery-1234',
  sequence: 1,
  previousSequence: 0,
  createdAt: 1000,
  plans: [],
};
const broadcast = {
  operationId: batch.id,
  transactionHash: 'real-stored-hash',
  signerId: 'relayer.testnet',
  state: 'broadcasting',
  createdAt: 1000,
  signedTransactionBase64: 'exact-original-signed-envelope',
};
const confirmed = () => ({
  id: batch.id,
  sequence: 1,
  batchHash: settlementBatchHash(batch),
  blockHeight: 100,
  timestamp: 2000,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.stubEnv('NEAR_CONTRACT_ID', 'worldo.testnet');
  mock.read.mockResolvedValue(broadcast);
  mock.write.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe('durable batch broadcast recovery', () => {
  it('rebroadcasts only the exact persisted envelope after an interrupted first send', async () => {
    mock.view.mockResolvedValueOnce(null).mockResolvedValueOnce(confirmed());
    mock.rpc
      .mockRejectedValueOnce(new Error('Unknown transaction'))
      .mockResolvedValueOnce({
        transaction: {hash: broadcast.transactionHash, signer_id: broadcast.signerId},
        status: {SuccessValue: ''},
      });
    const result = await reconcileWorldBatch(batch);
    expect(mock.rpc.mock.calls[1]).toEqual([
      {signed_tx_base64: broadcast.signedTransactionBase64, wait_until: 'FINAL'},
      'send_tx',
    ]);
    expect(result.receipt?.transactionHash).toBe(broadcast.transactionHash);
    expect(result.safeToAbort).toBe(false);
    expect(mock.write).toHaveBeenCalledWith(
      expect.objectContaining({state: 'confirmed', transactionHash: broadcast.transactionHash}),
    );
  });
  it('retains uncertainty during an outage without inventing a receipt or another spend', async () => {
    mock.view.mockResolvedValue(null);
    mock.rpc.mockRejectedValue(new Error('Offline'));
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: false});
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('permits a fresh broadcast only after a recorded execution failure', async () => {
    mock.view.mockResolvedValue(null);
    mock.read.mockResolvedValue({...broadcast, state: 'failed'});
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: true});
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('requires the matching on-chain batch before returning a successful transaction receipt', async () => {
    mock.view.mockResolvedValue(null);
    mock.rpc.mockResolvedValue({
      transaction: {hash: broadcast.transactionHash, signer_id: broadcast.signerId},
      status: {SuccessValue: ''},
    });
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: false});
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('rejects an on-chain receipt for different effects or sequence', async () => {
    mock.view.mockResolvedValue({...confirmed(), batchHash: 'different'});
    await expect(reconcileWorldBatch(batch)).rejects.toThrow('does not match');
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('does not retry a batch with an on-chain receipt but a lost broadcast journal', async () => {
    mock.view.mockResolvedValue(confirmed());
    mock.read.mockResolvedValue(null);
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: false});
  });
  it('rejects an unrelated transaction outcome even if the batch exists', async () => {
    mock.view.mockResolvedValue(confirmed());
    mock.rpc.mockResolvedValue({
      transaction: {hash: 'another-hash', signer_id: broadcast.signerId},
      status: {SuccessValue: ''},
    });
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: false});
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('allows a new envelope for the immutable batch only after verified FINAL expiry', async () => {
    mock.read.mockResolvedValue({...broadcast, delegateMaxBlockHeight: 300});
    mock.view.mockResolvedValue(null);
    mock.rpc.mockImplementation(async (_params, method) => {
      if (method === 'block') return {header: {height: 301}};
      throw new Error('Unknown transaction');
    });
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: true});
    expect(mock.rpc).toHaveBeenCalledWith({finality: 'final'}, 'block');
    expect(mock.rpc.mock.calls.some(call => call[1] === 'send_tx')).toBe(false);
    expect(mock.write).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionHash: broadcast.transactionHash,
        state: 'expired',
        delegateMaxBlockHeight: 300,
        finalizedExpiryHeight: 301,
      }),
    );
  });
  it('does not treat the last still-valid block as expiry', async () => {
    mock.read.mockResolvedValue({...broadcast, delegateMaxBlockHeight: 300});
    mock.view.mockResolvedValue(null);
    mock.rpc.mockImplementation(async (_params, method) => {
      if (method === 'block') return {header: {height: 300}};
      throw new Error('Offline');
    });
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: false});
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('retains an uncertain envelope if the final height cannot be verified', async () => {
    mock.read.mockResolvedValue({...broadcast, delegateMaxBlockHeight: 300});
    mock.view.mockResolvedValue(null);
    mock.rpc.mockRejectedValue(new Error('Offline'));
    await expect(reconcileWorldBatch(batch)).resolves.toEqual({receipt: null, safeToAbort: false});
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('returns the successful old attempt when its replacement failed', async () => {
    const old = {...broadcast, state: 'expired', delegateMaxBlockHeight: 300, finalizedExpiryHeight: 301};
    mock.read.mockResolvedValue({
      ...broadcast,
      transactionHash: 'replacement-hash',
      state: 'failed',
      previousAttempts: [old],
    });
    mock.view.mockResolvedValue(confirmed());
    mock.rpc.mockResolvedValue({
      transaction: {hash: broadcast.transactionHash, signer_id: broadcast.signerId},
      status: {SuccessValue: ''},
    });
    const result = await reconcileWorldBatch(batch);
    expect(result.receipt?.transactionHash).toBe(broadcast.transactionHash);
    expect(result.safeToAbort).toBe(false);
    expect(mock.rpc).toHaveBeenCalledWith(
      {tx_hash: broadcast.transactionHash, sender_account_id: broadcast.signerId, wait_until: 'FINAL'},
      'tx',
    );
  });
  it('rechecks the batch after a replacement fails before locating the earlier winner', async () => {
    mock.read.mockResolvedValue({
      ...broadcast,
      transactionHash: 'replacement-hash',
      previousAttempts: [{...broadcast, state: 'expired', delegateMaxBlockHeight: 300, finalizedExpiryHeight: 301}],
    });
    mock.view.mockResolvedValueOnce(null).mockResolvedValue(confirmed());
    mock.rpc
      .mockResolvedValueOnce({
        transaction: {hash: 'replacement-hash', signer_id: broadcast.signerId},
        status: {Failure: 'Batch replay'},
      })
      .mockResolvedValueOnce({
        transaction: {hash: broadcast.transactionHash, signer_id: broadcast.signerId},
        status: {SuccessValue: ''},
      });
    const result = await reconcileWorldBatch(batch);
    expect(result.receipt?.transactionHash).toBe(broadcast.transactionHash);
    expect(mock.write).toHaveBeenCalledWith(
      expect.objectContaining({transactionHash: 'replacement-hash', state: 'failed'}),
    );
  });
});
