import type {CityId, CityState, SettlementPlan, StationState, WorldData} from '../../shared/game';
import {CITY_PUMPS} from '../../shared/city-layout';
import {CITIES} from '../../shared/config/cities';
import {
  DRIVER_CITY_FUEL_LITRES,
  DRIVER_IDLE_MS,
  DRIVER_PAY_PER_CYCLE,
  DRIVER_TARGET_COINS,
  DRIVER_TRAVEL_SPEED,
  GRANT_RESERVE,
  OFFLINE_SUMMARY_GRACE_MS,
  PRICE_CAP_DURATION_MS,
  STATION_CITY_TAX,
  STATION_SERVICE_MS,
  STATION_WEAR_PER_LITRE,
} from '../../shared/config/stations';
import {FESTIVAL_WAGES} from '../../shared/config/events';
import {REPUTATION_FAIR_SALE, REPUTATION_GOUGING} from '../../shared/config/reputation';
import {burn, transfer} from './ledger';
import {chooseStation, stationScore, type StationChoice} from './driverChoice';
import {changeReputation, reputationScore} from './reputation';
import {spendingMoney, unitPrice, updateCompetition} from './pricingRules';
import {reservedDriverCoins} from './ownership';

/** Work earns NPC wages from the same finite city treasuries. No wages are paid
 * for idle time, and protected recovery/order funds are never spent on wages. */
export function payProductionWage(data: WorldData, city: CityState, plan: SettlementPlan, maximum = 4) {
  const driver = [...city.drivers].sort((a, b) => a.coins - b.coins)[0];
  if (!driver) return;
  const wage = Math.max(0, Math.min(maximum, DRIVER_TARGET_COINS - driver.coins, spendingMoney(city)));
  if (!wage) return;
  city.treasury -= wage;
  data.world.starterPool += wage;
  driver.coins += wage;
  transfer(plan, city.accountId, data.contractId, 'coin', wage);
}
/** Regular pay keeps buyers in the market after building stops. Spare pool coins
 * pay first, because that money already sits with the drivers on-chain. After that
 * the city pays from its own treasury, so coins always keep moving in a loop. */
export function payDrivers(data: WorldData, city: CityState, plan: SettlementPlan) {
  const festival = data.world.event?.kind === 'festival' && data.world.event.cityId === city.id;
  const pay = Math.round(DRIVER_PAY_PER_CYCLE * city.policy.wageRate * (festival ? FESTIVAL_WAGES : 1));
  for (const driver of city.drivers) {
    const wage = Math.min(pay, DRIVER_TARGET_COINS - driver.coins);
    if (wage <= 0) continue;
    const spare = Math.max(0, data.world.starterPool - reservedDriverCoins(data) - GRANT_RESERVE),
      fromPool = Math.min(wage, spare);
    driver.coins += fromPool;
    const fromCity = Math.min(wage - fromPool, spendingMoney(city));
    if (fromCity > 0) {
      city.treasury -= fromCity;
      data.world.starterPool += fromCity;
      driver.coins += fromCity;
      transfer(plan, city.accountId, data.contractId, 'coin', fromCity);
    }
  }
}
function stationEffect(plan: SettlementPlan, station: StationState, petrolDelta: number) {
  const existing = plan.stationEffects!.find(e => e.stationId === station.id);
  if (existing) existing.petrolDelta += petrolDelta;
  else plan.stationEffects!.push({stationId: station.id, ownerId: station.ownerId!, petrolDelta});
}
/** Drivers never buy a city back into a blackout. A city is dark below 10% fuel, so its
 * pump keeps at least that much. Otherwise a queue at a dark city takes every litre the
 * refinery makes, and a delivery can never turn the lights back on. */
function driverFloor(cityId: CityId) {
  return Math.max(CITIES[cityId].protectedFuel, Math.ceil(CITIES[cityId].fuelCapacity / 10));
}
function choices(data: WorldData, city: CityState): StationChoice[] {
  const own = CITY_PUMPS.find(p => p.cityId === city.id)!;
  return [
    {
      id: `city:${city.id}`,
      position: own.position,
      price: city.stationPrice,
      queueLength: city.drivers.filter(d => d.stationId === `city:${city.id}` && d.phase !== 'leaving').length,
      availableLitres: Math.max(0, city.stock.petrol - driverFloor(city.id)),
      servingCapacity: 2,
      reputation: 0,
      playerOwned: false,
    },
    ...Object.values(data.world.stations)
      .filter(s => s.cityId === city.id && s.ownerId)
      .map(s => ({
        id: s.id,
        position: s.position,
        price: s.effectivePrice,
        queueLength: city.drivers.filter(d => d.stationId === s.id && d.phase !== 'leaving').length,
        availableLitres: s.progress >= 100 ? s.tank : 0,
        servingCapacity: s.pumpDurability <= 0 ? 0 : s.pumpDurability < 50 ? 1 : 2,
        reputation: reputationScore(data.players[s.ownerId!], city.id),
        playerOwned: true,
      })),
  ];
}
function remember(data: WorldData, station: StationState, message: string, presenceTime: number) {
  const owner = data.players[station.ownerId!],
    summary = owner?.offlineSummary;
  if (summary && presenceTime - owner.lastActiveAt > OFFLINE_SUMMARY_GRACE_MS && !summary.events.includes(message))
    summary.events = [...summary.events.slice(-5), message];
}
export function advanceStations(
  data: WorldData,
  plan: SettlementPlan,
  dt: number,
  presenceTime = data.world.simulatedAt,
) {
  const now = data.world.simulatedAt;
  for (const city of Object.values(data.world.cities)) {
    if (city.priceCapUntil <= now) {
      city.priceCap = null;
      city.priceCapUntil = 0;
    }
    for (const station of Object.values(data.world.stations).filter(s => s.cityId === city.id && s.ownerId)) {
      const shortage = city.state === 'dark' || city.state === 'struggling',
        fair = Math.max(1, unitPrice(city, 'petrol', 'sell'));
      const gouging = shortage && station.price > Math.ceil(fair * 1.5) && station.tank > 0;
      station.protest = gouging ? Math.min(1, station.protest + dt / 60000) : Math.max(0, station.protest - dt / 60000);
      if (gouging && Math.floor((now - dt) / 30000) !== Math.floor(now / 30000)) {
        changeReputation(data, station.ownerId!, city.id, REPUTATION_GOUGING);
        remember(data, station, 'Residents protested high fuel prices.', presenceTime);
      }
      if (gouging && station.protest >= 0.75 && reputationScore(data.players[station.ownerId!], city.id) < -10) {
        city.priceCap = Math.ceil(fair * 1.25);
        city.priceCapUntil = now + PRICE_CAP_DURATION_MS;
        remember(data, station, 'The mayor imposed a temporary price cap.', presenceTime);
      }
      station.effectivePrice = city.priceCap ? Math.min(station.price, city.priceCap) : station.price;
    }
    const served = new Map<string, number>();
    for (const driver of city.drivers) {
      if (driver.phase === 'leaving' && now < driver.readyAt) continue;
      if (driver.phase === 'leaving') {
        driver.phase = 'seeking';
        driver.stationId = null;
      }
      if (now < driver.readyAt && driver.phase === 'seeking') continue;
      const available = choices(data, city),
        best = chooseStation(driver, available),
        current = available.find(s => s.id === driver.stationId);
      if (!best) {
        driver.phase = 'queued';
        driver.stationId ??= `city:${city.id}`;
        continue;
      }
      // Drivers keep their current route unless the alternative is meaningfully
      // better; this prevents oscillating between queues on every server tick.
      if (
        driver.stationId !== best.id &&
        (!current ||
          current.availableLitres < driver.litresWanted ||
          stationScore(driver, best) + 0.8 <
            stationScore(driver, {...current, queueLength: Math.max(0, current.queueLength - 1)}))
      ) {
        driver.previousStationId = driver.stationId;
        driver.stationId = best.id;
        driver.phase = 'travelling';
        driver.assignedAt = now;
        driver.readyAt =
          now +
          Math.max(
            5000,
            ((12 + Math.hypot(driver.position.x - best.position.x, driver.position.z - best.position.z)) /
              DRIVER_TRAVEL_SPEED) *
              1000,
          );
        continue;
      }
      const target = available.find(s => s.id === driver.stationId) ?? best;
      if (driver.phase === 'travelling') {
        if (now < driver.readyAt) continue;
        driver.position = {...target.position};
        driver.phase = 'queued';
        driver.readyAt = now + STATION_SERVICE_MS;
        continue;
      }
      if (driver.phase === 'seeking') {
        driver.phase = 'travelling';
        driver.stationId = target.id;
        driver.assignedAt = now;
        driver.readyAt = now + 5000;
        continue;
      }
      if (now < driver.readyAt || (served.get(target.id) ?? 0) >= target.servingCapacity) continue;
      const quantity = driver.litresWanted,
        cost = quantity * target.price;
      if (driver.coins < cost || target.availableLitres < quantity) continue;
      driver.coins -= cost;
      data.world.starterPool -= cost;
      const cityFuel = Math.min(DRIVER_CITY_FUEL_LITRES, quantity - 1),
        consumed = quantity - cityFuel;
      if (target.playerOwned) {
        const station = data.world.stations[target.id],
          owner = data.players[station.ownerId!];
        if (!owner) throw new Error('A station owner must exist');
        station.tank -= quantity;
        stationEffect(plan, station, -quantity);
        station.pumpDurability = Math.max(0, station.pumpDurability - quantity * STATION_WEAR_PER_LITRE);
        const tax = Math.floor(cost * STATION_CITY_TAX),
          earned = cost - tax;
        city.treasury += tax;
        transfer(plan, data.contractId, city.accountId, 'coin', tax);
        owner.coins += earned;
        transfer(plan, data.contractId, owner.accountId, 'coin', earned);
        burn(plan, owner.accountId, 'petrol', consumed, 'fuel');
        transfer(plan, owner.accountId, city.accountId, 'petrol', cityFuel);
        city.stock.petrol += cityFuel;
        station.litresSoldToday += quantity;
        station.revenueToday += earned;
        station.totalLitresSold += quantity;
        station.totalRevenue += earned;
        station.lastSaleAt = now;
        if (presenceTime - owner.lastActiveAt > OFFLINE_SUMMARY_GRACE_MS) {
          owner.offlineSummary.litresSold += quantity;
          owner.offlineSummary.coinsEarned += earned;
        }
        if ((city.state === 'dark' || city.state === 'struggling') && station.price <= city.stationPrice)
          changeReputation(data, owner.accountId, city.id, REPUTATION_FAIR_SALE);
        if (station.tank < quantity) remember(data, station, 'The station ran out of petrol.', presenceTime);
      } else {
        city.stock.petrol -= consumed;
        city.treasury += cost;
        transfer(plan, data.contractId, city.accountId, 'coin', cost);
        burn(plan, city.accountId, 'petrol', consumed, 'fuel');
        city.marketShareSales += quantity;
      }
      city.marketShareTotal += quantity;
      served.set(target.id, (served.get(target.id) ?? 0) + 1);
      driver.phase = 'leaving';
      driver.readyAt = now + DRIVER_IDLE_MS;
      driver.assignedAt = now;
    }
    for (const stationId of [
      `city:${city.id}`,
      ...Object.values(data.world.stations)
        .filter(s => s.cityId === city.id)
        .map(s => s.id),
    ]) {
      const queue = city.drivers
        .filter(d => d.stationId === stationId && d.phase !== 'leaving')
        .sort((a, b) => a.assignedAt - b.assignedAt || a.id.localeCompare(b.id));
      queue.forEach((d, i) => (d.queueIndex = i));
      const station = data.world.stations[stationId];
      if (station) station.queueLength = queue.length;
    }
    if (Math.floor((now - dt) / 30000) !== Math.floor(now / 30000)) {
      updateCompetition(data, city);
      city.marketShareSales *= 0.92;
      city.marketShareTotal *= 0.92;
      // Only current competition affects opinion. A historic low market-share
      // ratio can persist while every pump is dry; it must not punish an inactive
      // owner forever after their last sale.
      if (city.marketShare < 0.2)
        for (const station of Object.values(data.world.stations).filter(
          s => s.cityId === city.id && s.ownerId && s.lastSaleAt > now - 30000,
        ))
          changeReputation(data, station.ownerId!, city.id, -1);
    }
  }
}
