import {describe, it, expect} from 'vitest';
import type {SettlementPlan, SettlementBatch} from '../shared/game';
import {validateSettlementPlan, settlementBatchHash} from '../server/city-chain';
import {validateCityGameAuthorization, type GameplaySession} from '../server/gameplay-sessions';
import {estimateWorldBatchLogBytes} from '../shared/batches';
const plan = (): SettlementPlan => ({
  id: 'operation-1234',
  accountId: 'alice.testnet',
  action: 'buy',
  nonce: 1,
  createdAt: 2000,
  expiresAt: 120000,
  transfers: [{from: 'alice.testnet', to: 'refinery.testnet', tokenId: 'coin', amount: 20}],
  mints: [],
  burns: [],
  stationEffects: [],
  metadata: {authorizationAt: 1000},
});
const grant: GameplaySession = {
  accountId: 'alice.testnet',
  publicKey: 'ed25519:example',
  network: 'testnet',
  contractId: 'worldo.testnet',
  expiresAt: 10000,
  spendLimit: 100,
  spent: 40,
  authorizedAt: 1000,
  createdAt: 1000,
  state: 'active',
};
describe('bounded background authority', () => {
  it('counts settled and queued spending once, including concurrent accepted actions', () => {
    expect(validateCityGameAuthorization(grant, plan(), 60)).toBe(80);
    expect(validateCityGameAuthorization(grant, plan(), 0)).toBe(60);
    expect(() => validateCityGameAuthorization(grant, plan(), 90)).toThrow('exhausted');
  });
  it('rejects wrong account, expired action time, revoked grant and negative spend', () => {
    expect(() => validateCityGameAuthorization({...grant, accountId: 'bob.testnet'}, plan(), 0)).toThrow();
    expect(() => validateCityGameAuthorization({...grant, expiresAt: 1500}, plan(), 0)).toThrow();
    expect(() => validateCityGameAuthorization({...grant, state: 'revoked'}, plan(), 0)).toThrow();
    const p = plan();
    p.transfers[0].amount = -20;
    expect(() => validateCityGameAuthorization(grant, p, 0)).toThrow('amount');
  });
  it('keeps coins fixed and amounts safe integers', () => {
    const p = plan();
    p.mints.push({to: p.accountId, tokenId: 'coin', amount: 1, reason: 'harvest'});
    expect(() => validateSettlementPlan(p)).toThrow('cannot mint');
    p.mints = [];
    p.transfers[0].amount = 1.5;
    expect(() => validateSettlementPlan(p)).toThrow('integer');
  });
  it('binds batch order, sequence, effects and station allocations with stable canonical hashes', () => {
    const b: SettlementBatch = {id: 'batch-1234', sequence: 1, previousSequence: 0, plans: [plan()], createdAt: 3000};
    const reordered = {createdAt: b.createdAt, plans: b.plans, previousSequence: 0, sequence: 1, id: b.id};
    expect(settlementBatchHash(reordered)).toBe(settlementBatchHash(b));
    const altered = structuredClone(b);
    altered.plans[0].stationEffects = [{stationId: 'station:refinery:1', ownerId: 'alice.testnet', petrolDelta: 5}];
    expect(settlementBatchHash(altered)).not.toBe(settlementBatchHash(b));
  });
  it('aggregates repeated asset events but accounts for mayor metadata bytes', () => {
    const b: SettlementBatch = {
      id: 'batch-1234',
      sequence: 1,
      previousSequence: 0,
      plans: Array.from({length: 20}, (_, i) => ({...plan(), id: 'operation-' + i})),
      createdAt: 3000,
    };
    expect(estimateWorldBatchLogBytes(b)).toBeLessThan(2000);
    b.plans[19].metadata.mayorRecords = JSON.stringify([{cityId: 'motor', reason: 'x'.repeat(10000)}]);
    expect(estimateWorldBatchLogBytes(b)).toBeGreaterThan(10000);
  });
});
