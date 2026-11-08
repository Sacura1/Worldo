import type {SettlementPlan, WorldData} from '../../shared/game';
import {GameError} from '../errors';

export function newPlan(
  data: WorldData,
  accountId: string,
  action: SettlementPlan['action'],
  now: number,
  id: string,
): SettlementPlan {
  if (!id || id.length > 128) throw new GameError('An operation identifier is required.', 400);
  return {
    id,
    accountId,
    action,
    nonce: action === 'tick' ? data.world.economyRevision + 1 : (data.players[accountId]?.nonce ?? 0) + 1,
    createdAt: now,
    expiresAt: now + 120000,
    transfers: [],
    mints: [],
    burns: [],
    stationEffects: [],
    metadata: {},
  };
}
export function transfer(plan: SettlementPlan, from: string, to: string, tokenId: string, amount: number) {
  if (!amount || from === to) return;
  integer(amount);
  const existing = plan.transfers.find(t => t.from === from && t.to === to && t.tokenId === tokenId);
  if (existing) existing.amount += amount;
  else plan.transfers.push({from, to, tokenId, amount});
}
export function mint(
  plan: SettlementPlan,
  to: string,
  tokenId: string,
  amount: number,
  reason: SettlementPlan['mints'][number]['reason'],
) {
  if (!amount) return;
  integer(amount);
  if (tokenId === 'coin') throw new Error('Gameplay cannot mint coins');
  const existing = plan.mints.find(t => t.to === to && t.tokenId === tokenId && t.reason === reason);
  if (existing) existing.amount += amount;
  else plan.mints.push({to, tokenId, amount, reason});
}
export function burn(
  plan: SettlementPlan,
  from: string,
  tokenId: string,
  amount: number,
  reason: SettlementPlan['burns'][number]['reason'],
) {
  if (!amount) return;
  integer(amount);
  if (tokenId === 'coin') throw new Error('Gameplay cannot burn coins');
  const existing = plan.burns.find(t => t.from === from && t.tokenId === tokenId && t.reason === reason);
  if (existing) existing.amount += amount;
  else plan.burns.push({from, tokenId, amount, reason});
}
export function hasEffects(plan: SettlementPlan) {
  return !!(
    plan.transfers.length + plan.mints.length + plan.burns.length + (plan.stationEffects?.length ?? 0) ||
    plan.metadata.requiresSync
  );
}
export function integer(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000)
    throw new GameError('Quantity must be a positive whole number.', 400);
}
export function coinTotal(data: WorldData) {
  return (
    data.world.starterPool +
    Object.values(data.world.cities).reduce((n, c) => n + c.treasury, 0) +
    Object.values(data.players).reduce((n, p) => n + p.coins, 0)
  );
}
export function assertLedger(data: WorldData) {
  if (coinTotal(data) !== data.world.initialCoinSupply) throw new Error('Coin conservation failed');
  const totals = [
    data.world.starterPool,
    ...Object.values(data.world.cities).flatMap(c => [c.treasury, ...Object.values(c.stock)]),
    ...Object.values(data.players).flatMap(p => [
      p.coins,
      ...Object.values(p.inventory),
      ...Object.values(p.warehouse),
    ]),
  ];
  if (totals.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid economic balance');
  for (const city of Object.values(data.world.cities))
    if (city.bounties.reduce((n, b) => n + b.reservedCoins, 0) + (city.supplyReservedCoins ?? 0) > city.treasury)
      throw new Error('Reserved orders exceed treasury');
  const drivers = Object.values(data.world.cities).flatMap(c => c.drivers ?? []);
  if (
    drivers.some(d => !Number.isSafeInteger(d.coins) || d.coins < 0) ||
    drivers.reduce((n, d) => n + d.coins, 0) > data.world.starterPool
  )
    throw new Error('Driver budgets exceed their funded pool');
  for (const station of Object.values(data.world.stations ?? {}))
    if (!Number.isSafeInteger(station.tank) || station.tank < 0 || station.tank > station.tankCapacity)
      throw new Error('Invalid station tank');
  for (const p of Object.values(data.players))
    for (const raw of ['crude_oil', 'rubber', 'wood'] as const)
      if (p.unminted[raw] > p.inventory[raw] || p.unminted[raw] < 0 || p.warehouseUnminted[raw] > p.warehouse[raw])
        throw new Error('Invalid harvest provenance');
}
