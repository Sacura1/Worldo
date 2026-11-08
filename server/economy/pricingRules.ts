import type {
  CityId,
  CityState,
  EquipmentInstance,
  EquipmentKind,
  PriceQuote,
  Resource,
  WorldData,
} from '../../shared/game';
import {CITIES} from '../../shared/config/cities';
import {ITEMS, RESOURCES} from '../../shared/config/items';
import {PRICE_WAR_MAX_DISCOUNT, PRICE_WAR_SHARE_THRESHOLD, PUMP_MARKUP} from '../../shared/config/stations';
import {reputationPrice, reputationScore} from './reputation';

export const BASE_PRICES: Record<Resource, number> = {crude_oil: 4, petrol: 12, rubber: 6, wood: 5};
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const reservedCoins = (city: CityState) =>
  city.bounties.reduce((n, b) => n + b.reservedCoins, 0) + (city.supplyReservedCoins ?? 0);
export const spendingMoney = (city: CityState, emergency = false) =>
  Math.max(0, city.treasury - reservedCoins(city) - (emergency ? 0 : city.recoveryReserve));
export const cityAccepts = (id: CityId, resource: Resource) =>
  resource === 'petrol'
    ? id !== 'refinery'
    : id === 'refinery'
      ? resource === 'crude_oil'
      : resource === 'rubber' || resource === 'wood';

const MAX_SCARCITY = 2.1;
const MIN_SCARCITY = 0.65;
/** Below its target a city's premium falls in a straight line as stock arrives, so
 * even a first cart moves the price. Above the target it eases down to the minimum. */
function scarcityOf(stock: number, target: number) {
  return stock < target ? MAX_SCARCITY - (MAX_SCARCITY - 1) * (stock / target) : Math.max(MIN_SCARCITY, target / stock);
}
/** A bid rises with scarce stock, prolonged demand and a struggling city, and each
 * mayor can tilt it inside POLICY_LIMITS.priceRate.
 * Recovery reserves may only buy the inputs needed to restart the city. */
export function unitPrice(city: CityState, resource: Resource, side: 'buy' | 'sell'): number {
  const target = CITIES[city.id].targetStock[resource] || 40;
  const scarcity = scarcityOf(city.stock[resource], target);
  const urgency = city.state === 'dark' || city.state === 'struggling' ? 1.2 : 1;
  const momentum = clamp(1 + city.demand[resource] * 0.012, 0.9, 1.2);
  // A save from before this setting has no rate until its world next loads.
  const mayorRate = city.policy?.priceRate ?? 1;
  const bid = Math.max(1, Math.round(BASE_PRICES[resource] * scarcity * urgency * momentum * mayorRate));
  // Petrol's retail floor covers two crude inputs yielding three petrol, plus freight.
  const refiningCost = Math.max(Math.ceil((unitCrudeCost(city) * 2) / 3) + 2, Math.ceil(city.fuelCostBasis ?? 0) + 1);
  return side === 'buy'
    ? bid
    : Math.max(
        resource === 'petrol' ? refiningCost : 1,
        Math.ceil(bid * 1.2 * (resource === 'petrol' ? 1 - (city.competitionDiscount ?? 0) : 1)),
      );
}
function unitCrudeCost(city: CityState) {
  const target = CITIES.refinery.targetStock.crude_oil;
  return Math.round(BASE_PRICES.crude_oil * scarcityOf(city.stock.crude_oil, target) * 1.2);
}
/** Each unit moves the stock, so a big order walks the price as it fills.
 * Flooding a market makes it cheap inside the same order, not only afterwards. */
function orderPrices(city: CityState, resource: Resource, cityBuys: boolean, quantity: number) {
  const steps = Math.min(Math.max(1, quantity), 200),
    size = Math.max(1, quantity) / steps;
  let total = 0,
    first = 0,
    last = 0;
  for (let i = 0; i < steps; i++) {
    const moved = Math.floor(i * size),
      units = Math.floor((i + 1) * size) - moved,
      stock = Math.max(0, city.stock[resource] + (cityBuys ? moved : -moved));
    const price = unitPrice({...city, stock: {...city.stock, [resource]: stock}}, resource, cityBuys ? 'buy' : 'sell');
    if (i === 0) first = price;
    last = price;
    total += price * units;
  }
  return {first, last, average: total / Math.max(1, quantity)};
}
export function bountyPrice(city: CityState, resource: Resource) {
  return Math.ceil(unitPrice(city, resource, 'buy') * city.policy.bountyPremium);
}
export function equipmentPrice(city: CityState, kind: EquipmentKind): number {
  const scarcity = clamp((CITIES.motor.targetStock.rubber + 20) / (city.stock.rubber + 20), 0.9, 1.5);
  return Math.ceil(ITEMS[kind].price * scarcity * (city.state === 'struggling' ? 1.1 : 1));
}
export function repairPrice(city: CityState, item: EquipmentInstance): number {
  const wear = 1 - item.durability / Math.max(1, item.maxDurability);
  return Math.max(
    5,
    Math.ceil(ITEMS[item.kind].price * (0.08 + wear * 0.15) * clamp(35 / Math.max(15, city.stock.rubber), 1, 1.6)),
  );
}
export const pumpPrice = (city: CityState) => Math.ceil(unitPrice(city, 'petrol', 'sell') * PUMP_MARKUP);
export function refreshPrices(city: CityState) {
  for (const resource of RESOURCES) {
    city.prices.buy[resource] = cityAccepts(city.id, resource) ? unitPrice(city, resource, 'buy') : 0;
    city.prices.sell[resource] = resource === 'petrol' ? unitPrice(city, resource, 'sell') : 0;
  }
  city.stationPrice = pumpPrice(city);
}
/** Competition discounts are bounded and never below replacement/refining cost. */
export function updateCompetition(data: WorldData, city: CityState) {
  const rivals = Object.values(data.world.stations).filter(
    s => s.cityId === city.id && s.ownerId && s.progress >= 100 && s.tank >= 2,
  );
  city.marketShare = city.marketShareTotal > 0 ? city.marketShareSales / city.marketShareTotal : 1;
  if (rivals.length && city.marketShare < PRICE_WAR_SHARE_THRESHOLD && spendingMoney(city) > 100)
    city.competitionDiscount = Math.min(PRICE_WAR_MAX_DISCOUNT, city.competitionDiscount + 0.025);
  else city.competitionDiscount = Math.max(0, city.competitionDiscount - 0.01);
  const nextPrice = pumpPrice(city);
  city.competitionReason =
    city.competitionDiscount > 0
      ? nextPrice < city.stationPrice
        ? `Losing customers to nearby stations. Cutting price to ${nextPrice} coins.`
        : `Losing customers to nearby stations, but short supply holds the price at ${nextPrice} coins.`
      : 'Prices cover fuel replacement and keep the city running.';
}
export function quoteTrade(
  data: WorldData,
  cityId: CityId,
  resource: Resource,
  side: 'buy' | 'sell',
  quantity = 1,
  bountyId?: string,
  accountId?: string,
): PriceQuote {
  const city = data.world.cities[cityId];
  const bounty = bountyId
    ? city.bounties.find(b => b.id === bountyId && b.resource === resource && b.expiresAt > data.world.simulatedAt)
    : undefined;
  const emergency = resource === 'petrol' || (cityId === 'refinery' && resource === 'crude_oil');
  const reputation = reputationScore(accountId ? data.players[accountId] : undefined, cityId);
  const fill = orderPrices(city, resource, side === 'sell', quantity);
  let price = bounty?.unitPrice ?? reputationPrice(Math.max(1, Math.round(fill.average)), reputation, side);
  // Reputation must not make same-city petrol buy/sell round trips profitable.
  if (!bounty && resource === 'petrol' && side === 'sell')
    price = Math.min(price, Math.max(1, reputationPrice(unitPrice(city, resource, 'sell'), reputation, 'buy') - 1));
  const maxQuantity =
    side === 'sell'
      ? cityAccepts(cityId, resource)
        ? bountyId
          ? bounty
            ? Math.min(bounty.remaining, Math.floor(bounty.reservedCoins / price))
            : 0
          : Math.floor(spendingMoney(city, emergency) / price)
        : 0
      : resource === 'petrol'
        ? Math.max(0, city.stock.petrol - CITIES[cityId].protectedFuel)
        : 0;
  const reason = bounty
    ? `Emergency delivery: ${bounty.remaining} units reserved at ${price} coins each.`
    : `${price} coins per unit; fuel ${Math.round(city.fuelPercent)}%, ${resource.replaceAll('_', ' ')} stock ${city.stock[resource]}/${CITIES[cityId].targetStock[resource]}.`;
  return {
    cityId,
    resource,
    side,
    unitPrice: price,
    quantity,
    total: price * quantity,
    maxQuantity,
    reason,
    bountyId: bounty?.id,
    available: quantity > 0 && quantity <= maxQuantity,
    firstUnitPrice: bounty ? price : reputationPrice(fill.first, reputation, side),
    lastUnitPrice: bounty ? price : reputationPrice(fill.last, reputation, side),
  };
}
