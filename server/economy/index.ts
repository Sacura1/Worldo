import type {
  CityId,
  CityState,
  EquipmentInstance,
  EquipmentKind,
  GameAction,
  GameSnapshot,
  Inventory,
  Network,
  PlayerState,
  Resource,
  SettlementPlan,
  Transition,
  WorldData,
} from '../../shared/game';
import {
  CITIES,
  CITY_IDS,
  CONSTRUCTION_PLOTS,
  INITIAL_DAY_FRACTION,
  SAME_CITY_RESALE_WINDOW_MS,
  STARTER_POOL,
} from '../../shared/config/cities';
import {FIRST_WORLD_EVENT_DELAY_MS, OIL_BOOM_EXTRA_CRUDE} from '../../shared/config/events';
import {
  CARGO_UPGRADES,
  emptyInventory,
  FUEL_CHARGE_PER_PETROL,
  ITEMS,
  RAW_RESOURCES,
  RESOURCES,
  STARTER_COINS,
  STARTER_EQUIPMENT,
  STORAGE_RENT,
  STORAGE_RENT_MS,
  VEHICLE_WEAR_PER_METER,
  WALK_SPEED,
  WAREHOUSE_UPGRADES,
  WORN_STARTER_MULTIPLIER,
} from '../../shared/config/items';
import {
  CITY_CENTERS,
  CITY_DOORS,
  CITY_START_POSITION,
  CITY_TRADE_POINTS,
  cityInterior,
  getCityColliders,
  RESOURCE_NODES,
} from '../../shared/city-layout';
import {
  bodyCollides,
  findSafeVehicleExit,
  motionIsClear,
  MOVE_BANK_SECONDS,
  movementIsPossible,
} from '../../shared/world-physics';
import {GameError} from '../errors';
import {assertLedger, burn, hasEffects, integer, mint, newPlan, transfer} from './ledger';
import {equipmentPrice, quoteTrade, repairPrice} from './pricingRules';
import {event, fuelState, refreshCity} from './citySim';
import {applyStationAction, createDrivers, createStations, initializeOwnership, reservedDriverCoins} from './ownership';
import {rewardDelivery} from './reputation';
import {applyContractAction} from './contracts';
import {defaultPolicy} from './mayorPolicy';
export {quoteTrade, equipmentPrice, repairPrice} from './pricingRules';
export {advanceWorld} from './citySim';
export {coinTotal, assertLedger} from './ledger';
export {GameError} from '../errors';

export interface WorldOptions {
  network: Network;
  contractId: string;
  cityAccounts: Record<CityId, string>;
  now?: number;
}
const blankRaw = () => ({crude_oil: 0, rubber: 0, wood: 0});
export function createWorld(options: WorldOptions): WorldData {
  const now = options.now ?? Date.now();
  if (!options.contractId || CITY_IDS.some(id => !options.cityAccounts[id]))
    throw new GameError('A deployed contract and all three mayor accounts are required.', 503);
  const cities = Object.fromEntries(
    CITY_IDS.map(id => {
      const cfg = CITIES[id],
        fuelPercent = (cfg.initialStock.petrol / cfg.fuelCapacity) * 100;
      const city: CityState = {
        id,
        accountId: options.cityAccounts[id],
        treasury: cfg.initialTreasury,
        recoveryReserve: cfg.recoveryReserve,
        stock: {...cfg.initialStock},
        fuelPercent,
        state: fuelState(fuelPercent),
        stateChangedAt: now,
        fuelBurnRemainder: 0,
        productionRemainder: 0,
        constructionRemainder: 0,
        equipmentStock: Object.fromEntries(Object.keys(ITEMS).map(k => [k, 0])) as Record<EquipmentKind, number>,
        equipmentInventory: [],
        prices: {buy: emptyInventory(), sell: emptyInventory()},
        bounties: [],
        construction:
          id === 'harbor'
            ? Array.from({length: CONSTRUCTION_PLOTS}, (_, i) => ({
                id: `harbor-plot-${i}`,
                progress: 0,
                complete: false,
                stalled: false,
                woodUsed: 0,
                rubberUsed: 0,
              }))
            : [],
        shortageSince: {},
        bountyCooldowns: {},
        demand: emptyInventory(),
        protest: 0,
        workshopIdle: 0,
        shipsWaiting: 0,
        productionActive: false,
        freightEarned: 0,
        drivers: createDrivers(id, now),
        marketShare: 1,
        marketShareSales: 0,
        marketShareTotal: 0,
        stationPrice: 0,
        fuelCostBasis: id === 'refinery' ? 6 : 18,
        competitionDiscount: 0,
        competitionReason: 'Prices cover fuel replacement and keep the city running.',
        priceCap: null,
        priceCapUntil: 0,
        supplyReservedCoins: 0,
        lastContractAt: now,
        policy: defaultPolicy(now),
        importedLitres: 0,
        lastImportNoteAt: 0,
      };
      return [id, city];
    }),
  ) as Record<CityId, CityState>;
  const data: WorldData = {
    version: 1,
    network: options.network,
    contractId: options.contractId,
    players: {},
    world: {
      id: `${options.network}:${options.contractId}`,
      revision: 0,
      economyRevision: 0,
      createdAt: now,
      updatedAt: now,
      simulatedAt: now,
      day: 1,
      dayFraction: INITIAL_DAY_FRACTION,
      cities,
      doors: {},
      events: [],
      starterPool: STARTER_POOL,
      initialCoinSupply: STARTER_POOL + CITY_IDS.reduce((n, id) => n + CITIES[id].initialTreasury, 0),
      equipmentSerial: 0,
      preview: false,
      stations: createStations(),
      supplyContracts: [],
      event: null,
      nextEventAt: now + FIRST_WORLD_EVENT_DELAY_MS,
      eventCount: 0,
    },
  };
  for (const city of Object.values(cities)) refreshCity(data, city);
  return data;
}
export function equipmentInstance(kind: EquipmentKind, id: string): EquipmentInstance {
  const cfg = ITEMS[kind];
  return {
    id,
    kind,
    durability: cfg.durability,
    maxDurability: cfg.durability,
    fuel: 0,
    ...(cfg.category === 'vehicle' ? {position: {...CITY_START_POSITION}, heading: 0} : {}),
  };
}
export function registerPlayer(source: WorldData, accountId: string, now: number, operationId: string): Transition {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(accountId)) throw new GameError('A verified NEAR account is required.', 401);
  if (source.players[accountId]) return {data: source, plan: null};
  const data = initializeOwnership(structuredClone(source)),
    plan = newPlan(data, accountId, 'register', now, operationId);
  if (data.world.starterPool - reservedDriverCoins(data) < STARTER_COINS)
    throw new GameError('The funded newcomer grant pool is empty. Please try later.', 503);
  const equipment = STARTER_EQUIPMENT.map(kind => equipmentInstance(kind, `equipment:${accountId}:${kind}:0`));
  data.players[accountId] = {
    accountId,
    coins: STARTER_COINS,
    position: {...CITY_START_POSITION},
    heading: 0,
    driving: false,
    activeVehicleId: equipment[3].id,
    equipment,
    inventory: emptyInventory(),
    unminted: blankRaw(),
    equippedTools: {crude_oil: equipment[0].id, rubber: equipment[1].id, wood: equipment[2].id},
    warehouse: emptyInventory(),
    warehouseUnminted: blankRaw(),
    warehouseLevel: 0,
    cargoLevel: 0,
    storagePaidUntil: 0,
    gathering: null,
    lastMoveAt: now,
    movementCredit: 1,
    joinedAt: now,
    lastActiveAt: now,
    nonce: plan.nonce,
    purchases: [],
    reputation: {refinery: 0, motor: 0, harbor: 0},
    offlineSummary: {since: now, litresSold: 0, coinsEarned: 0, events: []},
  };
  data.world.starterPool -= STARTER_COINS;
  transfer(plan, data.contractId, accountId, 'coin', STARTER_COINS);
  for (const item of equipment) mint(plan, accountId, item.id, 1, 'starter');
  data.world.revision++;
  data.world.economyRevision++;
  assertLedger(data);
  return {data, plan};
}
export function snapshot(data: WorldData, accountId: string): GameSnapshot {
  const player = data.players[accountId];
  if (!player) throw new GameError('Sign in to enter Worldo.', 401);
  return {world: data.world, player, network: data.network, contractId: data.contractId, receipt: player.receipt};
}
export const cargoUsed = (p: PlayerState) => Object.values(p.inventory).reduce((a, b) => a + b, 0);
export function cargoCapacity(p: PlayerState) {
  const vehicle = p.equipment.find(e => e.id === p.activeVehicleId);
  const nearby =
    !vehicle?.position || Math.hypot(p.position.x - vehicle.position.x, p.position.z - vehicle.position.z) < 16;
  return (
    (nearby && vehicle ? ITEMS[vehicle.kind].capacity : 20) +
    (p.cargoLevel ? CARGO_UPGRADES[p.cargoLevel - 1].capacity : 0)
  );
}
export function assertNearCity(player: PlayerState, cityId: CityId) {
  if (
    !CITIES[cityId] ||
    cityInterior(player.position)?.cityId !== cityId ||
    Math.hypot(player.position.x - CITY_TRADE_POINTS[cityId].x, player.position.z - CITY_TRADE_POINTS[cityId].z) > 7
  )
    throw new GameError('Enter the city exchange to speak with its mayor.', 400);
}
function owned(player: PlayerState, id: string) {
  const item = player.equipment.find(e => e.id === id);
  if (!item) throw new GameError('You do not own this equipment.', 400);
  return item;
}
function ensureCargo(player: PlayerState, resource: Resource, amount: number) {
  if (cargoUsed(player) + amount > cargoCapacity(player))
    throw new GameError('Your cargo is full. Sell or store some supplies first.', 400);
  const vehicle = player.equipment.find(e => e.id === player.activeVehicleId);
  if (
    vehicle?.kind === 'tanker' &&
    (resource === 'wood' || resource === 'rubber') &&
    player.inventory.wood + player.inventory.rubber + amount > 40
  )
    throw new GameError('The tanker holds at most 40 solid supplies; its large tank is for liquids.', 400);
}
function spend(player: PlayerState, city: CityState, coins: number, plan: SettlementPlan) {
  if (player.coins < coins) throw new GameError('You need more coins for this purchase.', 400);
  player.coins -= coins;
  city.treasury += coins;
  transfer(plan, player.accountId, city.accountId, 'coin', coins);
}
function deliver(player: PlayerState, city: CityState, resource: Resource, quantity: number, plan: SettlementPlan) {
  if (player.inventory[resource] < quantity) throw new GameError('You do not have enough cargo.', 400);
  const mined = resource === 'petrol' ? 0 : Math.min(quantity, player.unminted[resource]);
  if (resource !== 'petrol') player.unminted[resource] -= mined;
  player.inventory[resource] -= quantity;
  city.stock[resource] += quantity;
  mint(plan, city.accountId, resource, mined, 'harvest');
  transfer(plan, player.accountId, city.accountId, resource, quantity - mined);
}
export function applyAction(
  source: WorldData,
  accountId: string,
  action: GameAction,
  now: number,
  operationId: string,
): Transition {
  const data = initializeOwnership(structuredClone(source)),
    player = data.players[accountId];
  if (!player) throw new GameError('Sign in to enter Worldo.', 401);
  if (!Number.isFinite(now) || now < player.lastActiveAt) throw new GameError('Invalid action time.', 400);
  const plan = newPlan(data, accountId, action.type, now, operationId);
  player.lastActiveAt = now;
  switch (action.type) {
    case 'move': {
      const vehicle = owned(player, player.activeVehicleId),
        distance = Math.hypot(action.position.x - player.position.x, action.position.z - player.position.z);
      const speed = player.driving ? ITEMS[vehicle.kind].speed : WALK_SPEED;
      const credit = Math.min(
        speed * MOVE_BANK_SECONDS,
        player.movementCredit + (Math.max(0, now - player.lastMoveAt) / 1000) * speed * 1.08,
      );
      if (!Number.isFinite(distance) || !Number.isFinite(action.heading) || distance > credit + 0.001)
        throw new GameError('Movement exceeds your current speed.', 400);
      if (
        player.driving &&
        (vehicle.durability <= 0 ||
          (ITEMS[vehicle.kind].fuelCapacity > 0 && vehicle.fuel < distance * ITEMS[vehicle.kind].fuelPerMeter))
      )
        throw new GameError('Your vehicle needs fuel or a repair.', 400);
      if (
        !movementIsPossible(
          player.position,
          action.position,
          player.heading,
          action.heading,
          player.driving,
          getCityColliders(data.world.doors, data.world.stations),
        )
      )
        throw new GameError('The way is blocked.', 400);
      player.position = {...action.position};
      player.heading = action.heading;
      player.movementCredit = Math.max(0, credit - distance);
      player.lastMoveAt = now;
      if (player.driving) {
        vehicle.position = {...player.position};
        vehicle.heading = player.heading;
        vehicle.fuel = Math.max(0, vehicle.fuel - distance * ITEMS[vehicle.kind].fuelPerMeter);
        vehicle.durability = Math.max(0, vehicle.durability - distance * VEHICLE_WEAR_PER_METER);
      } else if (vehicle.kind === 'hand_cart') vehicle.position = {...player.position};
      if (player.gathering) {
        const node = RESOURCE_NODES.find(n => n.id === player.gathering!.nodeId);
        if (!node || Math.hypot(player.position.x - node.position.x, player.position.z - node.position.z) > 3)
          player.gathering = null;
      }
      break;
    }
    case 'door': {
      const door = CITY_DOORS.find(d => d.id === action.doorId);
      if (
        !door ||
        Math.hypot(player.position.x - door.position.x, player.position.z - door.position.z) > 3.5 ||
        player.driving
      )
        throw new GameError('Walk up to the door first.', 400);
      const candidate = {...data.world.doors, [door.id]: action.open};
      if (
        Object.values(data.players).some(p =>
          bodyCollides(p.position, p.heading, p.driving, getCityColliders(candidate, data.world.stations)),
        )
      )
        throw new GameError('Someone is in the doorway.', 400);
      data.world.doors = candidate;
      break;
    }
    case 'vehicle': {
      const item = owned(player, action.equipmentId);
      if (ITEMS[item.kind].category !== 'vehicle') throw new GameError('Select a vehicle.', 400);
      if (action.driving) {
        if (item.kind === 'hand_cart') {
          player.activeVehicleId = item.id;
          break;
        }
        if (!item.position || Math.hypot(player.position.x - item.position.x, player.position.z - item.position.z) > 5)
          throw new GameError('Walk up to your vehicle first.', 400);
        player.position = {...item.position};
        player.heading = item.heading ?? 0;
        player.activeVehicleId = item.id;
        player.driving = true;
      } else if (player.driving) {
        const exit = findSafeVehicleExit(
          player.position,
          player.heading,
          getCityColliders(data.world.doors, data.world.stations),
        );
        if (!exit) throw new GameError('There is no room to step out here.', 400);
        player.position = exit;
        player.driving = false;
      }
      player.gathering = null;
      player.movementCredit = 0;
      player.lastMoveAt = now;
      break;
    }
    case 'equip': {
      const item = owned(player, action.equipmentId),
        cfg = ITEMS[item.kind];
      if (cfg.category === 'vehicle') {
        if (player.driving) throw new GameError('Step out before selecting another vehicle.', 400);
        player.activeVehicleId = item.id;
      } else if (cfg.resource) player.equippedTools[cfg.resource] = item.id;
      player.gathering = null;
      break;
    }
    case 'gather_start': {
      const node = RESOURCE_NODES.find(n => n.id === action.nodeId);
      if (
        !node ||
        player.driving ||
        Math.hypot(player.position.x - node.position.x, player.position.z - node.position.z) > 3
      )
        throw new GameError('Walk to a resource node to gather.', 400);
      const item = owned(player, player.equippedTools[node.resource]),
        cfg = ITEMS[item.kind];
      if (cfg.resource !== node.resource) throw new GameError('This tool cannot collect that material.', 400);
      if (cfg.fuelPerUse && (item.durability <= 0 || item.fuel < cfg.fuelPerUse))
        throw new GameError('Refuel or repair this tool, or equip your starter tool.', 400);
      ensureCargo(player, node.resource, cfg.yield);
      player.gathering = {
        nodeId: node.id,
        resource: node.resource,
        toolId: item.id,
        startedAt: now,
        durationMs: cfg.gatherMs * (item.durability <= 0 ? WORN_STARTER_MULTIPLIER : 1),
      };
      break;
    }
    case 'gather_finish': {
      const gathering = player.gathering;
      if (!gathering) throw new GameError('Start gathering at a resource node first.', 400);
      const node = RESOURCE_NODES.find(n => n.id === gathering.nodeId)!,
        item = owned(player, gathering.toolId),
        cfg = ITEMS[item.kind];
      if (now - gathering.startedAt < gathering.durationMs)
        throw new GameError('Keep gathering until the tool finishes.', 400);
      if (player.driving || Math.hypot(player.position.x - node.position.x, player.position.z - node.position.z) > 3)
        throw new GameError('Stay beside the resource while gathering.', 400);
      const gathered =
        cfg.yield +
        (gathering.resource === 'crude_oil' && data.world.event?.kind === 'oil_boom' ? OIL_BOOM_EXTRA_CRUDE : 0);
      ensureCargo(player, gathering.resource, gathered);
      player.inventory[gathering.resource] += gathered;
      player.unminted[gathering.resource] += gathered;
      item.durability = Math.max(0, item.durability - 1);
      item.fuel = Math.max(0, item.fuel - cfg.fuelPerUse);
      player.gathering = null;
      break;
    }
    case 'gather_cancel':
      player.gathering = null;
      break;
    case 'sell': {
      integer(action.quantity);
      assertNearCity(player, action.cityId);
      const city = data.world.cities[action.cityId];
      const quote = quoteTrade(
        data,
        action.cityId,
        action.resource,
        'sell',
        action.quantity,
        action.bountyId,
        accountId,
      );
      if (!quote.available)
        throw new GameError(
          action.bountyId
            ? 'This bounty has expired or its reserved quantity is exhausted.'
            : 'The mayor cannot fund this delivery right now.',
          400,
        );
      if (action.limit !== undefined) {
        integer(action.limit);
        if (quote.total < action.limit)
          throw new GameError('The price changed. Review the new quote before trading.', 409);
      }
      if (
        action.bountyId &&
        player.purchases.some(
          p => p.cityId === action.cityId && p.resource === action.resource && now - p.at < SAME_CITY_RESALE_WINDOW_MS,
        )
      )
        throw new GameError('Emergency bounties do not buy back supplies recently purchased from this city.', 400);
      rewardDelivery(data, accountId, action.cityId, action.quantity);
      deliver(player, city, action.resource, action.quantity, plan);
      city.treasury -= quote.total;
      player.coins += quote.total;
      transfer(plan, city.accountId, accountId, 'coin', quote.total);
      if (quote.bountyId) {
        const bounty = city.bounties.find(b => b.id === quote.bountyId)!;
        bounty.remaining -= action.quantity;
        bounty.reservedCoins -= quote.total;
        city.bounties = city.bounties.filter(b => b.remaining > 0);
      }
      city.demand[action.resource] = Math.max(-10, city.demand[action.resource] - action.quantity / 10);
      plan.metadata = {
        cityId: action.cityId,
        resource: action.resource,
        quantity: action.quantity,
        unitPrice: quote.unitPrice,
        bountyId: quote.bountyId ?? '',
      };
      event(data, action.cityId, 'trade', `${action.quantity} ${action.resource.replaceAll('_', ' ')} delivered.`);
      break;
    }
    // The contract only accepts newly harvested goods as a sale, so a gift settles
    // as a sale with no payment. Calling it anything else would block the chain queue.
    case 'donate': {
      integer(action.quantity);
      assertNearCity(player, action.cityId);
      const city = data.world.cities[action.cityId];
      deliver(player, city, action.resource, action.quantity, plan);
      plan.action = 'sell';
      plan.metadata = {cityId: action.cityId, resource: action.resource, quantity: action.quantity, gift: true};
      break;
    }
    case 'buy': {
      integer(action.quantity);
      assertNearCity(player, action.cityId);
      const city = data.world.cities[action.cityId],
        quote = quoteTrade(data, action.cityId, action.resource, 'buy', action.quantity, undefined, accountId);
      if (!quote.available) throw new GameError('These supplies are reserved to keep the city running.', 400);
      if (action.limit !== undefined) {
        integer(action.limit);
        if (quote.total > action.limit)
          throw new GameError('The price changed. Review the new quote before trading.', 409);
      }
      ensureCargo(player, action.resource, action.quantity);
      spend(player, city, quote.total, plan);
      city.stock[action.resource] -= action.quantity;
      player.inventory[action.resource] += action.quantity;
      transfer(plan, city.accountId, accountId, action.resource, action.quantity);
      city.demand[action.resource] += action.quantity / 10;
      player.purchases = player.purchases.filter(p => now - p.at < SAME_CITY_RESALE_WINDOW_MS);
      player.purchases.push({cityId: action.cityId, resource: action.resource, quantity: action.quantity, at: now});
      plan.metadata = {
        cityId: action.cityId,
        resource: action.resource,
        quantity: action.quantity,
        unitPrice: quote.unitPrice,
      };
      break;
    }
    case 'buy_equipment': {
      assertNearCity(player, 'motor');
      const city = data.world.cities.motor;
      if (!ITEMS[action.kind]) throw new GameError('Unknown equipment.', 400);
      if (city.state === 'dark') throw new GameError('Deliver petrol to reopen the Motor showroom.', 400);
      const index = city.equipmentInventory.findIndex(e => e.kind === action.kind);
      if (index < 0) throw new GameError('The workshop needs wood and rubber to build this model.', 400);
      const price = equipmentPrice(city, action.kind);
      spend(player, city, price, plan);
      const [item] = city.equipmentInventory.splice(index, 1);
      city.equipmentStock[item.kind]--;
      if (ITEMS[item.kind].category === 'vehicle') {
        item.position = {x: CITY_CENTERS.motor.x, z: CITY_CENTERS.motor.z + 14};
        item.heading = 0;
      }
      player.equipment.push(item);
      transfer(plan, city.accountId, accountId, item.id, 1);
      plan.metadata = {equipmentId: item.id, kind: item.kind, cost: price};
      break;
    }
    case 'repair': {
      assertNearCity(player, 'motor');
      const city = data.world.cities.motor,
        item = owned(player, action.equipmentId);
      if (city.state === 'dark') throw new GameError('The workshop needs petrol before repairs can resume.', 400);
      if (item.durability >= item.maxDurability) throw new GameError('This equipment does not need a repair.', 400);
      if (city.stock.rubber < 1) throw new GameError('The workshop needs rubber for repairs.', 400);
      const price = repairPrice(city, item);
      spend(player, city, price, plan);
      city.stock.rubber--;
      burn(plan, city.accountId, 'rubber', 1, 'production');
      item.maxDurability = Math.max(5, Math.floor(item.maxDurability * 0.9));
      item.durability = item.maxDurability;
      plan.metadata = {equipmentId: item.id, cost: price};
      break;
    }
    case 'refuel': {
      integer(action.quantity);
      const item = owned(player, action.equipmentId),
        cfg = ITEMS[item.kind];
      if (cfg.fuelCapacity === 0) throw new GameError('This equipment does not use petrol.', 400);
      if (
        cfg.category === 'vehicle' &&
        item.position &&
        Math.hypot(player.position.x - item.position.x, player.position.z - item.position.z) > 6
      )
        throw new GameError('Walk up to the vehicle to refuel it.', 400);
      const required = Math.ceil((cfg.fuelCapacity - item.fuel) / FUEL_CHARGE_PER_PETROL);
      if (action.quantity > required || player.inventory.petrol < action.quantity)
        throw new GameError('Choose an amount that fits the tank and your cargo.', 400);
      player.inventory.petrol -= action.quantity;
      item.fuel = Math.min(cfg.fuelCapacity, item.fuel + action.quantity * FUEL_CHARGE_PER_PETROL);
      burn(plan, accountId, 'petrol', action.quantity, 'fuel');
      plan.metadata = {equipmentId: item.id, quantity: action.quantity};
      break;
    }
    case 'upgrade': {
      assertNearCity(player, 'harbor');
      const city = data.world.cities.harbor;
      if (city.state === 'dark') throw new GameError('Deliver petrol to restart the Harbor workshop.', 400);
      const level = action.kind === 'cargo' ? player.cargoLevel : player.warehouseLevel,
        upgrade = (action.kind === 'cargo' ? CARGO_UPGRADES : WAREHOUSE_UPGRADES)[level];
      if (!upgrade) throw new GameError('This upgrade is already at its highest level.', 400);
      if (city.stock.wood < 4 || city.stock.rubber < 2)
        throw new GameError('Harbor needs four wood and two rubber for this upgrade.', 400);
      spend(player, city, upgrade.cost, plan);
      city.stock.wood -= 4;
      city.stock.rubber -= 2;
      burn(plan, city.accountId, 'wood', 4, 'production');
      burn(plan, city.accountId, 'rubber', 2, 'production');
      if (action.kind === 'cargo') player.cargoLevel++;
      else {
        player.warehouseLevel++;
        player.storagePaidUntil = now + STORAGE_RENT_MS;
      }
      plan.metadata = {kind: action.kind, cost: upgrade.cost};
      break;
    }
    case 'rent_storage': {
      assertNearCity(player, 'harbor');
      if (!player.warehouseLevel) throw new GameError('Buy a warehouse space first.', 400);
      spend(player, data.world.cities.harbor, STORAGE_RENT, plan);
      player.storagePaidUntil = Math.max(now, player.storagePaidUntil) + STORAGE_RENT_MS;
      plan.metadata = {kind: 'storage_rent', cost: STORAGE_RENT};
      break;
    }
    case 'storage': {
      integer(action.quantity);
      assertNearCity(player, 'harbor');
      if (!player.warehouseLevel) throw new GameError('Buy a warehouse space first.', 400);
      const deposit = action.direction === 'deposit';
      if (deposit && player.storagePaidUntil < now)
        throw new GameError(
          'Renew your warehouse rental before storing more cargo. Withdrawals remain available.',
          400,
        );
      const from = deposit ? player.inventory : player.warehouse,
        to = deposit ? player.warehouse : player.inventory;
      if (from[action.resource] < action.quantity) throw new GameError('Not enough supplies to move.', 400);
      if (
        deposit &&
        Object.values(player.warehouse).reduce((a, b) => a + b, 0) + action.quantity >
          WAREHOUSE_UPGRADES[player.warehouseLevel - 1].capacity
      )
        throw new GameError('The warehouse is full.', 400);
      if (!deposit) ensureCargo(player, action.resource, action.quantity);
      from[action.resource] -= action.quantity;
      to[action.resource] += action.quantity;
      if (action.resource !== 'petrol') {
        const a = deposit ? player.unminted : player.warehouseUnminted,
          b = deposit ? player.warehouseUnminted : player.unminted;
        const pending = Math.min(a[action.resource], action.quantity);
        a[action.resource] -= pending;
        b[action.resource] += pending;
      }
      break;
    }
    default:
      if (!applyStationAction(data, player, action, now, plan) && !applyContractAction(data, player, action, plan))
        throw new GameError('Unknown game action.', 400);
  }
  for (const city of Object.values(data.world.cities)) refreshCity(data, city);
  data.world.revision++;
  if (hasEffects(plan)) {
    player.nonce = plan.nonce;
    data.world.economyRevision++;
  }
  assertLedger(data);
  return {data, plan: hasEffects(plan) ? plan : null};
}
