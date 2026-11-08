import {afterEach, beforeEach, describe, it, expect, vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readBroadcast,
  writeBroadcast,
  broadcastCanBeReplaced,
  type BroadcastRecord,
} from '../server/city-chain-journal';
let folder: string;
const attempt = (hash = 'first-hash'): BroadcastRecord => ({
  operationId: 'journal-batch-1234',
  transactionHash: hash,
  signerId: 'relayer.testnet',
  state: 'broadcasting',
  createdAt: 1000,
  delegateMaxBlockHeight: 300,
  signedTransactionBase64: 'signed-envelope-' + hash,
});
beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'worldo-chain-journal-'));
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.stubEnv('NEAR_CONTRACT_ID', 'worldo.testnet');
  vi.stubEnv('LOCAL_DATA_DIR', folder);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const resolved = path.resolve(folder);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('worldo-chain-journal-')
  )
    throw new Error('Unexpected temporary directory');
  await rm(resolved, {recursive: true, force: true});
});
describe('durable broadcast attempt history', () => {
  it('does not replace an uncertain valid envelope', async () => {
    await writeBroadcast(attempt());
    await expect(writeBroadcast(attempt('second-hash'))).rejects.toThrow('Reconcile');
    expect((await readBroadcast('journal-batch-1234'))?.transactionHash).toBe('first-hash');
  });
  it('requires a final height strictly past the delegate expiry before replacement', () => {
    expect(broadcastCanBeReplaced({...attempt(), state: 'expired'})).toBe(false);
    expect(broadcastCanBeReplaced({...attempt(), state: 'expired', finalizedExpiryHeight: 300})).toBe(false);
    expect(broadcastCanBeReplaced({...attempt(), state: 'expired', finalizedExpiryHeight: 301})).toBe(true);
  });
  it('retains every old hash and signer while keeping only the current signed envelope', async () => {
    await writeBroadcast(attempt());
    await writeBroadcast({...attempt(), state: 'expired', finalizedExpiryHeight: 301});
    await writeBroadcast(attempt('second-hash'));
    let record = (await readBroadcast('journal-batch-1234'))!;
    expect(record.previousAttempts).toEqual([
      expect.objectContaining({
        transactionHash: 'first-hash',
        signerId: 'relayer.testnet',
        state: 'expired',
        finalizedExpiryHeight: 301,
      }),
    ]);
    expect(record.previousAttempts?.[0]).not.toHaveProperty('signedTransactionBase64');
    expect(record.signedTransactionBase64).toBe('signed-envelope-second-hash');
    await writeBroadcast({...attempt('second-hash'), state: 'failed'});
    await writeBroadcast(attempt('third-hash'));
    record = (await readBroadcast('journal-batch-1234'))!;
    expect(record.previousAttempts?.map(item => item.transactionHash)).toEqual(['first-hash', 'second-hash']);
    await writeBroadcast({...attempt('third-hash'), state: 'confirmed', confirmedAt: 2000});
    expect((await readBroadcast('journal-batch-1234'))?.previousAttempts).toHaveLength(2);
  });
  it('does not downgrade a confirmed attempt or overwrite its history from a stale caller', async () => {
    await writeBroadcast(attempt());
    await writeBroadcast({...attempt(), state: 'expired', finalizedExpiryHeight: 301});
    await writeBroadcast(attempt('second-hash'));
    await writeBroadcast({...attempt('second-hash'), state: 'confirmed', previousAttempts: [], confirmedAt: 2000});
    await expect(writeBroadcast({...attempt('second-hash'), state: 'failed'})).rejects.toThrow('finalized');
    const record = await readBroadcast('journal-batch-1234');
    expect(record?.state).toBe('confirmed');
    expect(record?.previousAttempts).toHaveLength(1);
  });
});
