import type {GameAction, PlayerState, Resource, SettlementPlan, WorldData} from '../../shared/game';
import {CITIES, DAY_LENGTH_MS} from '../../shared/config/cities';
import {OFFLINE_SUMMARY_GRACE_MS} from '../../shared/config/stations';
import {
  CONTRACT_COLLATERAL_FRACTION,
  CONTRACT_DAYS,
  CONTRACT_MAX_ACTIVE,
  CONTRACT_MAX_COLLATERAL,
  CONTRACT_MAX_QUANTITY,
  CONTRACT_MIN_QUANTITY,
  REPUTATION_CONTRACT_COMPLETED,
  REPUTATION_CONTRACT_FAILED,
  REPUTATION_CONTRACT_MIN,
  REPUTATION_PRIORITY,
} from '../../shared/config/reputation';
import {cityInterior} from '../../shared/city-layout';
import {GameError} from '../errors';
import {integer, mint, transfer} from './ledger';
import {spendingMoney, unitPrice} from './pricingRules';
import {changeReputation, reputationScore} from './reputation';

/** Forecasts produce bounded, fully funded offers. Locked payment and collateral
 * remain subsets of mayor treasury; normal purchases cannot spend either. */
export function advanceContracts(data: WorldData, plan: SettlementPlan, presenceTime = data.world.simulatedAt) {
  const now = data.world.simulatedAt;
  for (const contract of data.world.supplyContracts) {
    const city = data.world.cities[contract.cityId];
    if (contract.status === 'open' && contract.offerExpiresAt <= now) {
      contract.status = 'expired';
      city.supplyReservedCoins -= contract.reservedCoins;
      contract.reservedCoins = 0;
    }
    if (contract.status !== 'active' || contract.dueAt === null || contract.dueAt > now) continue;
    if (contract.deliveredToday < contract.quantityPerDay) {
      contract.status = 'failed';
      city.supplyReservedCoins -= contract.reservedCoins + contract.collateralHeld;
      contract.reservedCoins = 0;
      contract.collateralHeld = 0;
      changeReputation(data, contract.ownerId!, city.id, REPUTATION_CONTRACT_FAILED);
      const owner = data.players[contract.ownerId!],
        summary = owner?.offlineSummary;
      if (summary && presenceTime - owner.lastActiveAt > OFFLINE_SUMMARY_GRACE_MS)
        summary.events = [
          ...summary.events.slice(-5),
          'A supply contract missed its deadline; the reserved collateral was forfeited.',
        ];
    } else {
      contract.daysCompleted++;
      contract.deliveredToday = 0;
      contract.dueAt += DAY_LENGTH_MS;
    }
  }
  for (const city of Object.values(data.world.cities)) {
    if (
      now - city.lastContractAt < DAY_LENGTH_MS / 2 ||
      data.world.supplyContracts.some(c => c.cityId === city.id && c.status === 'open')
    )
      continue;
    city.lastContractAt = now;
    const resource: Resource =
      city.id === 'refinery'
        ? 'crude_oil'
        : city.id === 'motor'
          ? city.stock.rubber < city.stock.wood
            ? 'rubber'
            : 'wood'
          : 'wood';
    const deficit = Math.max(0, CITIES[city.id].targetStock[resource] - city.stock[resource]);
    const forecast = deficit / 3 + Math.max(0, city.demand[resource]) * 2 + (city.id === 'refinery' ? 20 : 8);
    const quantity = Math.max(CONTRACT_MIN_QUANTITY, Math.min(CONTRACT_MAX_QUANTITY, Math.ceil(forecast)));
    const price = Math.max(1, Math.ceil(unitPrice(city, resource, 'buy') * 1.05)),
      reserve = quantity * CONTRACT_DAYS * price;
    if (spendingMoney(city) < reserve) continue;
    city.supplyReservedCoins += reserve;
    data.world.supplyContracts.push({
      id: `supply:${city.id}:${now}`,
      cityId: city.id,
      resource,
      quantityPerDay: quantity,
      days: CONTRACT_DAYS,
      unitPrice: price,
      reservedCoins: reserve,
      collateral: Math.max(1, Math.min(CONTRACT_MAX_COLLATERAL, Math.ceil(reserve * CONTRACT_COLLATERAL_FRACTION))),
      collateralHeld: 0,
      ownerId: null,
      offeredAt: now,
      offerExpiresAt: now + DAY_LENGTH_MS,
      acceptedAt: null,
      dueAt: null,
      deliveredToday: 0,
      daysCompleted: 0,
      totalDelivered: 0,
      status: 'open',
    });
  }
  // Preserve completed records for the session journal without unbounded growth.
  data.world.supplyContracts = data.world.supplyContracts.filter(
    c => c.status === 'active' || c.status === 'open' || now - (c.dueAt ?? c.offerExpiresAt) < 7 * DAY_LENGTH_MS,
  );
}
export function applyContractAction(
  data: WorldData,
  player: PlayerState,
  action: GameAction,
  plan: SettlementPlan,
): boolean {
  if (action.type !== 'contract_accept' && action.type !== 'contract_deliver') return false;
  const contract = data.world.supplyContracts.find(c => c.id === action.contractId);
  if (!contract) throw new GameError('This supply contract is no longer available.', 400);
  const city = data.world.cities[contract.cityId],
    now = data.world.simulatedAt;
  if (cityInterior(player.position)?.cityId !== city.id)
    throw new GameError('Visit the city exchange to manage this contract.', 400);
  if (action.type === 'contract_accept') {
    if (contract.status !== 'open' || contract.offerExpiresAt <= now)
      throw new GameError('This contract is already taken or expired.', 400);
    const reputation = reputationScore(player, city.id);
    if (reputation < REPUTATION_CONTRACT_MIN)
      throw new GameError('Improve your reputation with this mayor before taking a contract.', 400);
    if (reputation < REPUTATION_PRIORITY && now - contract.offeredAt < 30000)
      throw new GameError('Trusted suppliers have first choice for the first thirty seconds.', 400);
    if (
      data.world.supplyContracts.filter(c => c.ownerId === player.accountId && c.status === 'active').length >=
      CONTRACT_MAX_ACTIVE
    )
      throw new GameError('You may hold at most two active supply contracts.', 400);
    if (player.coins < contract.collateral)
      throw new GameError('You need enough coins for the displayed contract collateral.', 400);
    player.coins -= contract.collateral;
    city.treasury += contract.collateral;
    city.supplyReservedCoins += contract.collateral;
    contract.collateralHeld = contract.collateral;
    transfer(plan, player.accountId, city.accountId, 'coin', contract.collateral);
    contract.ownerId = player.accountId;
    contract.status = 'active';
    contract.acceptedAt = now;
    contract.dueAt = now + DAY_LENGTH_MS;
    plan.metadata = {
      contractId: contract.id,
      collateral: contract.collateral,
      unitPrice: contract.unitPrice,
      quantityPerDay: contract.quantityPerDay,
      days: contract.days,
    };
    return true;
  }
  integer(action.quantity);
  if (
    contract.ownerId !== player.accountId ||
    contract.status !== 'active' ||
    contract.dueAt === null ||
    contract.dueAt <= now
  )
    throw new GameError('This contract is not an active delivery for you.', 400);
  if (action.quantity > contract.quantityPerDay - contract.deliveredToday)
    throw new GameError('Deliver no more than today’s remaining contract quantity.', 400);
  if (player.inventory[contract.resource] < action.quantity) throw new GameError('You do not have enough cargo.', 400);
  const raw = contract.resource === 'petrol' ? 0 : Math.min(player.unminted[contract.resource], action.quantity);
  if (contract.resource !== 'petrol') player.unminted[contract.resource] -= raw;
  player.inventory[contract.resource] -= action.quantity;
  city.stock[contract.resource] += action.quantity;
  mint(plan, city.accountId, contract.resource, raw, 'harvest');
  transfer(plan, player.accountId, city.accountId, contract.resource, action.quantity - raw);
  const payment = action.quantity * contract.unitPrice;
  contract.reservedCoins -= payment;
  city.supplyReservedCoins -= payment;
  city.treasury -= payment;
  player.coins += payment;
  transfer(plan, city.accountId, player.accountId, 'coin', payment);
  contract.deliveredToday += action.quantity;
  contract.totalDelivered += action.quantity;
  if (contract.daysCompleted === contract.days - 1 && contract.deliveredToday === contract.quantityPerDay) {
    contract.status = 'completed';
    contract.daysCompleted++;
    city.supplyReservedCoins -= contract.collateralHeld;
    city.treasury -= contract.collateralHeld;
    player.coins += contract.collateralHeld;
    transfer(plan, city.accountId, player.accountId, 'coin', contract.collateralHeld);
    contract.collateralHeld = 0;
    changeReputation(data, player.accountId, city.id, REPUTATION_CONTRACT_COMPLETED);
  }
  plan.metadata = {
    contractId: contract.id,
    quantity: action.quantity,
    unitPrice: contract.unitPrice,
    status: contract.status,
  };
  return true;
}
