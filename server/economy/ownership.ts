import type {
  CityId,
  DriverState,
  GameAction,
  PlayerState,
  Resource,
  SettlementPlan,
  StationState,
  WorldData,
} from '../../shared/game';
import {CITY_CENTERS, CITY_PUMPS, STATION_PLOTS} from '../../shared/city-layout';
import {CITIES, CITY_IDS, INITIAL_DAY_FRACTION} from '../../shared/config/cities';
import {FIRST_WORLD_EVENT_DELAY_MS} from '../../shared/config/events';
import {
  DRIVERS_PER_CITY,
  DRIVER_FILL_LITRES,
  DRIVER_STARTING_COINS,
  STATION_BUILD_FEE,
  STATION_BUILD_WOOD,
  STATION_MAX_PRICE,
  STATION_MIN_PRICE,
  STATION_PLOT_PRICE,
  STATION_PUMP_MAX_DURABILITY,
  STATION_REPAIR_PER_RUBBER,
  STATION_TANK_CAPACITY,
  STATION_UPGRADE,
} from '../../shared/config/stations';
import {GameError} from '../errors';
import {burn, integer, mint, transfer} from './ledger';
import {unitPrice} from './pricingRules';
import {defaultPolicy} from './mayorPolicy';

export function createStations(): Record<string, StationState> {
  return Object.fromEntries(
    STATION_PLOTS.map(plot => [
      plot.id,
      {
        id: plot.id,
        cityId: plot.cityId,
        ownerId: null,
        name: 'For Sale',
        position: {...plot.position},
        progress: 0,
        woodDelivered: 0,
        buildFeePaid: false,
        price: 18,
        effectivePrice: 18,
        tank: 0,
        tankCapacity: STATION_TANK_CAPACITY,
        pumpDurability: STATION_PUMP_MAX_DURABILITY,
        queueLength: 0,
        protest: 0,
        litresSoldToday: 0,
        revenueToday: 0,
        totalLitresSold: 0,
        totalRevenue: 0,
        lastSaleAt: 0,
      },
    ]),
  );
}
export function createDrivers(cityId: CityId, now: number, coins = DRIVER_STARTING_COINS): DriverState[] {
  return Array.from({length: DRIVERS_PER_CITY}, (_, i) => ({
    id: `driver:${cityId}:${i}`,
    cityId,
    stationId: null,
    previousStationId: null,
    queueIndex: i,
    phase: 'seeking',
    assignedAt: now,
    readyAt: now + i * 3000,
    position: {x: CITY_CENTERS[cityId].x - 25 + i * 7, z: CITY_CENTERS[cityId].z + 12},
    coins,
    litresWanted: DRIVER_FILL_LITRES,
    loyalty: (i % 4) / 3,
  }));
}
/** Backward-compatible initialization for saved city worlds. The driver budget
 * is a reservation within the existing pool, not newly created coins. */
export function initializeOwnership(data: WorldData): WorldData {
  data.world.stations ??= createStations();
  data.world.supplyContracts ??= [];
  data.world.event ??= null;
  data.world.nextEventAt ??= data.world.simulatedAt + FIRST_WORLD_EVENT_DELAY_MS;
  data.world.eventCount ??= 0;
  const perDriver = Math.min(
    DRIVER_STARTING_COINS,
    Math.floor(data.world.starterPool / (DRIVERS_PER_CITY * CITY_IDS.length)),
  );
  for (const id of CITY_IDS) {
    const city = data.world.cities[id];
    city.drivers ??= createDrivers(id, data.world.simulatedAt, perDriver);
    city.marketShare ??= 1;
    city.marketShareSales ??= 0;
    city.marketShareTotal ??= 0;
    city.stationPrice ??= unitPrice(city, 'petrol', 'sell');
    city.fuelCostBasis ??= id === 'refinery' ? 6 : 18;
    city.competitionDiscount ??= 0;
    city.competitionReason ??= 'Prices cover fuel replacement and keep the city running.';
    city.priceCap ??= null;
    city.priceCapUntil ??= 0;
    city.supplyReservedCoins ??= 0;
    city.lastContractAt ??= 0;
    city.policy ??= defaultPolicy(data.world.simulatedAt);
    city.importedLitres ??= 0;
    city.lastImportNoteAt ??= 0;
    for (const driver of city.drivers) driver.litresWanted = DRIVER_FILL_LITRES;
  }
  for (const player of Object.values(data.players)) {
    player.reputation ??= {refinery: 0, motor: 0, harbor: 0};
    player.offlineSummary ??= {since: player.lastActiveAt, litresSold: 0, coinsEarned: 0, events: []};
  }
  return data;
}
export function reservedDriverCoins(data: WorldData) {
  return Object.values(data.world.cities)
    .flatMap(c => c.drivers ?? [])
    .reduce((n, d) => n + d.coins, 0);
}
export function assertNearStation(player: PlayerState, station: StationState) {
  if (Math.hypot(player.position.x - station.position.x, player.position.z - station.position.z) > 9)
    throw new GameError('Visit this station plot to manage it.', 400);
}
export function consumePlayerResource(
  player: PlayerState,
  resource: Resource,
  quantity: number,
  plan: SettlementPlan,
  reason: 'construction' | 'production',
) {
  if (player.inventory[resource] < quantity) throw new GameError('You do not have enough cargo.', 400);
  player.inventory[resource] -= quantity;
  if (resource !== 'petrol') {
    const mined = Math.min(player.unminted[resource], quantity);
    player.unminted[resource] -= mined;
    mint(plan, player.accountId, resource, mined, 'harvest');
  }
  burn(plan, player.accountId, resource, quantity, reason);
}
function pay(player: PlayerState, data: WorldData, cityId: CityId, cost: number, plan: SettlementPlan) {
  if (player.coins < cost) throw new GameError('You need more coins for this purchase.', 400);
  player.coins -= cost;
  data.world.cities[cityId].treasury += cost;
  transfer(plan, player.accountId, data.world.cities[cityId].accountId, 'coin', cost);
}
export function applyStationAction(
  data: WorldData,
  player: PlayerState,
  action: GameAction,
  now: number,
  plan: SettlementPlan,
): boolean {
  if (action.type === 'offline_ack') {
    player.offlineSummary = {since: now, litresSold: 0, coinsEarned: 0, events: []};
    return true;
  }
  if (!action.type.startsWith('station_') || !('stationId' in action)) return false;
  const station = Object.hasOwn(data.world.stations, action.stationId)
    ? data.world.stations[action.stationId]
    : undefined;
  if (!station) throw new GameError('This station plot does not exist.', 400);
  assertNearStation(player, station);
  if (action.type !== 'station_buy' && station.ownerId !== player.accountId)
    throw new GameError('Only the station owner can manage this plot.', 403);
  const city = data.world.cities[station.cityId];
  switch (action.type) {
    case 'station_buy': {
      if (station.ownerId) throw new GameError('This station plot already has an owner.', 409);
      if (Object.values(data.world.stations).some(s => s.cityId === station.cityId && s.ownerId === player.accountId))
        throw new GameError('You may own one station in each city.', 400);
      pay(player, data, station.cityId, STATION_PLOT_PRICE, plan);
      station.ownerId = player.accountId;
      station.name =
        (action.name?.trim() || player.accountId.split('.')[0] + ' Fuel')
          .replace(/[\u0000-\u001f<>]/g, '')
          .slice(0, 32) || 'Fuel station';
      mint(plan, player.accountId, station.id, 1, 'manufacture');
      plan.metadata = {
        stationId: station.id,
        cityId: station.cityId,
        ownerId: player.accountId,
        cost: STATION_PLOT_PRICE,
      };
      break;
    }
    case 'station_build': {
      integer(action.quantity);
      if (station.progress >= 100) throw new GameError('This station is already built.', 400);
      if (action.quantity > STATION_BUILD_WOOD - station.woodDelivered)
        throw new GameError('Deliver only the wood still needed for construction.', 400);
      if (!station.buildFeePaid) {
        pay(player, data, station.cityId, STATION_BUILD_FEE, plan);
        station.buildFeePaid = true;
      }
      consumePlayerResource(player, 'wood', action.quantity, plan, 'construction');
      station.woodDelivered += action.quantity;
      station.progress = (station.woodDelivered / STATION_BUILD_WOOD) * 100;
      plan.metadata = {stationId: station.id, woodDelivered: station.woodDelivered, progress: station.progress};
      break;
    }
    case 'station_stock': {
      integer(action.quantity);
      if (station.progress < 100) throw new GameError('Complete construction before stocking the tank.', 400);
      if (station.tank + action.quantity > station.tankCapacity)
        throw new GameError('The station tank cannot hold that much petrol.', 400);
      if (player.inventory.petrol < action.quantity)
        throw new GameError('You do not have enough petrol in your cargo.', 400);
      player.inventory.petrol -= action.quantity;
      station.tank += action.quantity;
      plan.stationEffects!.push({stationId: station.id, ownerId: player.accountId, petrolDelta: action.quantity});
      plan.metadata = {stationId: station.id, quantity: action.quantity, requiresSync: true};
      break;
    }
    case 'station_price': {
      integer(action.price);
      if (action.price < STATION_MIN_PRICE || action.price > STATION_MAX_PRICE)
        throw new GameError('Choose a pump price between 1 and 60 coins.', 400);
      station.price = action.price;
      station.effectivePrice =
        city.priceCap && city.priceCapUntil > data.world.simulatedAt
          ? Math.min(station.price, city.priceCap)
          : station.price;
      plan.metadata = {
        stationId: station.id,
        price: station.price,
        effectivePrice: station.effectivePrice,
        requiresSync: true,
      };
      break;
    }
    case 'station_repair': {
      integer(action.quantity);
      const max = Math.ceil((STATION_PUMP_MAX_DURABILITY - station.pumpDurability) / STATION_REPAIR_PER_RUBBER);
      if (action.quantity > max) throw new GameError('Deliver only the rubber needed to repair the pumps.', 400);
      consumePlayerResource(player, 'rubber', action.quantity, plan, 'production');
      station.pumpDurability = Math.min(
        STATION_PUMP_MAX_DURABILITY,
        station.pumpDurability + action.quantity * STATION_REPAIR_PER_RUBBER,
      );
      plan.metadata = {stationId: station.id, pumpDurability: station.pumpDurability};
      break;
    }
    case 'station_upgrade': {
      if (station.progress < 100 || station.tankCapacity >= STATION_UPGRADE.capacity)
        throw new GameError('This tank cannot be upgraded further.', 400);
      pay(player, data, station.cityId, STATION_UPGRADE.cost, plan);
      consumePlayerResource(player, 'wood', STATION_UPGRADE.wood, plan, 'construction');
      consumePlayerResource(player, 'rubber', STATION_UPGRADE.rubber, plan, 'construction');
      station.tankCapacity = STATION_UPGRADE.capacity;
      plan.metadata = {stationId: station.id, tankCapacity: station.tankCapacity};
      break;
    }
  }
  return true;
}
