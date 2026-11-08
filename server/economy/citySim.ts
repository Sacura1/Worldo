import type {
  CityId,
  CityState,
  EquipmentKind,
  FuelState,
  SettlementPlan,
  Transition,
  WorldData,
} from '../../shared/game';
import {
  BOUNTY_COOLDOWN_MS,
  BOUNTY_LIFETIME_MS,
  BOUNTY_QUANTITY,
  BUILDING_FUEL_PER_SECOND,
  CITIES,
  CITY_IDS,
  CONSTRUCTION_CYCLE_MS,
  CONSTRUCTION_PROGRESS_PER_CYCLE,
  CONSTRUCTION_RUBBER_EVERY,
  DAY_LENGTH_MS,
  FREIGHT_FEE_PER_UNIT,
  IMPORT_INTERVAL_MS,
  IMPORT_LITRES,
  IMPORT_NOTE_INTERVAL_MS,
  IMPORT_UNIT_PRICE,
  INITIAL_DAY_FRACTION,
  MAX_OFFLINE_MS,
  MAYOR_TRADE_INTERVAL_MS,
  MOTOR_CYCLE_MS,
  REFINED_UNIT_COST,
  REFINERY_CRUDE_INPUT,
  REFINERY_CYCLE_MS,
  REFINERY_PETROL_OUTPUT,
  SHORTAGE_DELAY_MS,
  SIM_TICK_MS,
} from '../../shared/config/cities';
import {
  COLD_SNAP_BURN,
  STORM_HARBOR_BURN,
  WORLD_EVENT_DURATION_MS,
  WORLD_EVENT_INTERVAL_MS,
  WORLD_EVENT_TEXT,
  nextWorldEvent,
} from '../../shared/config/events';
import {DRIVER_PAY_INTERVAL_MS} from '../../shared/config/stations';
import {ITEMS, RESOURCES} from '../../shared/config/items';
import {assertLedger, burn, hasEffects, mint, newPlan, transfer} from './ledger';
import {bountyPrice, clamp, refreshPrices, spendingMoney, unitPrice} from './pricingRules';
import {advanceStations, payDrivers, payProductionWage} from './stations';
import {boundedPolicy, rulePolicy} from './mayorPolicy';
import {advanceContracts} from './contracts';
import {initializeOwnership} from './ownership';

export function fuelState(percent: number, previous?: FuelState): FuelState {
  // Two percentage points of hysteresis stop lights flickering at a boundary.
  if (previous === 'dark' && percent < 12) return 'dark';
  if (previous === 'struggling' && percent >= 8 && percent < 32) return 'struggling';
  if (previous === 'normal' && percent >= 28 && percent <= 72) return 'normal';
  if (previous === 'thriving' && percent > 68) return 'thriving';
  return percent < 10 ? 'dark' : percent < 30 ? 'struggling' : percent > 70 ? 'thriving' : 'normal';
}
export function event(
  data: WorldData,
  cityId: CityId,
  type: WorldData['world']['events'][number]['type'],
  message: string,
) {
  const w = data.world;
  w.events.push({
    id: `${w.simulatedAt}:${cityId}:${w.events.length}:${type}`,
    at: w.simulatedAt,
    cityId,
    type,
    message,
  });
  w.events = w.events.slice(-80);
}
export function refreshCity(data: WorldData, city: CityState) {
  city.fuelPercent = clamp((city.stock.petrol / CITIES[city.id].fuelCapacity) * 100, 0, 100);
  const next = fuelState(city.fuelPercent, city.state);
  if (next !== city.state) {
    const recovered = city.state === 'dark';
    city.state = next;
    city.stateChangedAt = data.world.simulatedAt;
    event(
      data,
      city.id,
      recovered ? 'recovery' : 'fuel_state',
      recovered ? `The lights are back on in ${CITIES[city.id].name}.` : `${CITIES[city.id].name} is ${next}.`,
    );
  }
  city.protest = clamp((30 - city.fuelPercent) / 30, 0, 1);
  city.workshopIdle = city.id === 'motor' ? clamp(1 - city.stock.rubber / 25, 0, 1) : 0;
  city.shipsWaiting = city.id === 'harbor' ? clamp(1 - city.stock.wood / 35, 0, 1) : 0;
  refreshPrices(city);
}
/** Starts and ends world events. The journal and the on-chain record both show them. */
function updateWorldEvent(data: WorldData) {
  const w = data.world,
    now = w.simulatedAt;
  if (w.event && w.event.endsAt <= now) {
    event(data, w.event.cityId ?? 'harbor', 'world', `${WORLD_EVENT_TEXT[w.event.kind].title} is over.`);
    w.event = null;
  }
  if (w.event || now < w.nextEventAt) return;
  const next = nextWorldEvent(w.id, w.eventCount, w.lastEventKind);
  w.event = {id: `event:${w.eventCount}`, ...next, startedAt: now, endsAt: now + WORLD_EVENT_DURATION_MS};
  w.eventCount++;
  w.lastEventKind = next.kind;
  w.nextEventAt = now + WORLD_EVENT_INTERVAL_MS;
  event(data, next.cityId ?? 'harbor', 'world', WORLD_EVENT_TEXT[next.kind].title);
}
function fuelBurnRate(data: WorldData, id: CityId) {
  const kind = data.world.event?.kind;
  return kind === 'cold_snap' ? COLD_SNAP_BURN : kind === 'storm' && id === 'harbor' ? STORM_HARBOR_BURN : 1;
}
/** Imports cost far more than refining, so they keep a quiet world alive without
 * replacing players. The payment returns to the pool that helps pay drivers. */
function importFuel(data: WorldData, plan: SettlementPlan) {
  const w = data.world;
  if (w.event?.kind === 'storm') return;
  for (const id of CITY_IDS) {
    const city = w.cities[id];
    if (city.fuelPercent >= city.policy.fuelReserve) continue;
    const litres = Math.min(IMPORT_LITRES, Math.floor(spendingMoney(city, true) / IMPORT_UNIT_PRICE));
    if (litres < 1) continue;
    const cost = litres * IMPORT_UNIT_PRICE;
    city.fuelCostBasis = (city.stock.petrol * city.fuelCostBasis + cost) / (city.stock.petrol + litres);
    city.treasury -= cost;
    w.starterPool += cost;
    city.stock.petrol += litres;
    city.importedLitres += litres;
    transfer(plan, city.accountId, data.contractId, 'coin', cost);
    mint(plan, city.accountId, 'petrol', litres, 'manufacture');
    if (w.simulatedAt - city.lastImportNoteAt >= IMPORT_NOTE_INTERVAL_MS) {
      city.lastImportNoteAt = w.simulatedAt;
      event(data, id, 'trade', `${CITIES[id].name} bought imported fuel at ${IMPORT_UNIT_PRICE} coins per litre.`);
    }
  }
}
function produce(data: WorldData, plan: SettlementPlan, dt: number) {
  const refinery = data.world.cities.refinery,
    faulty = data.world.event?.kind === 'refinery_fault';
  refinery.productionRemainder += dt;
  refinery.productionActive = refinery.stock.crude_oil >= REFINERY_CRUDE_INPUT && refinery.stock.petrol < 240;
  while (refinery.productionRemainder >= REFINERY_CYCLE_MS) {
    refinery.productionRemainder -= REFINERY_CYCLE_MS;
    if (!refinery.productionActive || (faulty && Math.floor(data.world.simulatedAt / REFINERY_CYCLE_MS) % 2 === 0))
      continue;
    refinery.fuelCostBasis =
      (refinery.stock.petrol * refinery.fuelCostBasis + REFINERY_PETROL_OUTPUT * REFINED_UNIT_COST) /
      (refinery.stock.petrol + REFINERY_PETROL_OUTPUT);
    refinery.stock.crude_oil -= REFINERY_CRUDE_INPUT;
    refinery.stock.petrol += REFINERY_PETROL_OUTPUT;
    burn(plan, refinery.accountId, 'crude_oil', REFINERY_CRUDE_INPUT, 'production');
    mint(plan, refinery.accountId, 'petrol', REFINERY_PETROL_OUTPUT, 'manufacture');
    payProductionWage(data, refinery, plan, 3);
    refinery.productionActive = refinery.stock.crude_oil >= REFINERY_CRUDE_INPUT && refinery.stock.petrol < 240;
  }
  const motor = data.world.cities.motor;
  motor.productionRemainder += dt;
  motor.productionActive = false;
  while (motor.productionRemainder >= MOTOR_CYCLE_MS) {
    motor.productionRemainder -= MOTOR_CYCLE_MS;
    if (motor.state === 'dark') continue;
    // Maintain one of every model before making duplicates. No unbounded stock minting.
    const kinds = (Object.keys(ITEMS) as EquipmentKind[]).sort(
      (a, b) => motor.equipmentStock[a] - motor.equipmentStock[b],
    );
    const kind = kinds.find(
      k =>
        motor.equipmentStock[k] < 2 &&
        motor.stock.wood >= ITEMS[k].recipe.wood &&
        motor.stock.rubber >= ITEMS[k].recipe.rubber,
    );
    if (!kind) continue;
    const cfg = ITEMS[kind],
      id = `equipment:motor:${kind}:${++data.world.equipmentSerial}`;
    motor.stock.wood -= cfg.recipe.wood;
    motor.stock.rubber -= cfg.recipe.rubber;
    motor.equipmentStock[kind]++;
    motor.productionActive = true;
    motor.equipmentInventory.push({id, kind, durability: cfg.durability, maxDurability: cfg.durability, fuel: 0});
    burn(plan, motor.accountId, 'wood', cfg.recipe.wood, 'production');
    burn(plan, motor.accountId, 'rubber', cfg.recipe.rubber, 'production');
    mint(plan, motor.accountId, id, 1, 'manufacture');
    payProductionWage(data, motor, plan, 8);
  }
  const harbor = data.world.cities.harbor;
  harbor.constructionRemainder += dt;
  harbor.productionActive = false;
  while (harbor.constructionRemainder >= CONSTRUCTION_CYCLE_MS) {
    harbor.constructionRemainder -= CONSTRUCTION_CYCLE_MS;
    const plot = harbor.construction.find(p => !p.complete);
    if (!plot) break;
    const needsRubber = (plot.woodUsed + 1) % CONSTRUCTION_RUBBER_EVERY === 0;
    plot.stalled = harbor.state === 'dark' || harbor.stock.wood < 1 || (needsRubber && harbor.stock.rubber < 1);
    if (plot.stalled) continue;
    harbor.stock.wood--;
    plot.woodUsed++;
    burn(plan, harbor.accountId, 'wood', 1, 'construction');
    if (needsRubber) {
      harbor.stock.rubber--;
      plot.rubberUsed++;
      burn(plan, harbor.accountId, 'rubber', 1, 'construction');
    }
    plot.progress = Math.min(100, plot.progress + CONSTRUCTION_PROGRESS_PER_CYCLE);
    harbor.productionActive = true;
    payProductionWage(data, harbor, plan, 3);
    if (plot.progress === 100) {
      plot.complete = true;
      plot.stalled = false;
      event(data, 'harbor', 'construction', 'A new Harbor building is complete and now uses petrol.');
    }
  }
  // Never accumulate an unlimited burst of production while inputs are absent.
  refinery.productionRemainder %= REFINERY_CYCLE_MS;
  motor.productionRemainder %= MOTOR_CYCLE_MS;
  harbor.constructionRemainder %= CONSTRUCTION_CYCLE_MS;
}
/** Refinery only ships real surplus. Imported fuel is for its own survival, so a
 * quiet world cannot turn imports into profit at another mayor's expense. */
const REFINERY_SHIPS_ABOVE = 0.35;
function mayorTrades(data: WorldData, plan: SettlementPlan) {
  const seller = data.world.cities.refinery,
    harbor = data.world.cities.harbor;
  if (seller.stock.petrol < CITIES.refinery.fuelCapacity * REFINERY_SHIPS_ABOVE) return;
  for (const id of ['motor', 'harbor'] as const) {
    const buyer = data.world.cities[id];
    if (buyer.stock.petrol > CITIES[id].fuelCapacity * 0.45) continue;
    const unit = unitPrice(seller, 'petrol', 'sell'),
      fee = id === 'harbor' ? 0 : FREIGHT_FEE_PER_UNIT;
    const quantity = Math.max(
      0,
      Math.min(12, Math.floor(spendingMoney(buyer, true) / (unit + fee)), seller.stock.petrol - 24),
    );
    if (!quantity) continue;
    const price = quantity * unit,
      freight = quantity * fee;
    buyer.fuelCostBasis = (buyer.stock.petrol * buyer.fuelCostBasis + price) / (buyer.stock.petrol + quantity);
    seller.stock.petrol -= quantity;
    buyer.stock.petrol += quantity;
    buyer.treasury -= price + freight;
    seller.treasury += price;
    harbor.treasury += freight;
    harbor.freightEarned += freight;
    transfer(plan, seller.accountId, buyer.accountId, 'petrol', quantity);
    transfer(plan, buyer.accountId, seller.accountId, 'coin', price);
    transfer(plan, buyer.accountId, harbor.accountId, 'coin', freight);
    payProductionWage(data, harbor, plan, 2);
    seller.demand.petrol += quantity / 12;
    event(data, id, 'trade', `${quantity} petrol delivered by the Harbor freight service.`);
  }
}
function bounties(data: WorldData, city: CityState) {
  const now = data.world.simulatedAt;
  city.bounties = city.bounties.filter(b => b.expiresAt > now && b.remaining > 0);
  const shortages: Record<'fuel' | 'rubber' | 'wood', boolean> = {
    fuel: city.fuelPercent < 25 || (city.id === 'refinery' && city.stock.crude_oil < 10),
    rubber: city.id === 'motor' && city.stock.rubber < 10,
    wood: city.id === 'harbor' && city.stock.wood < 10,
  };
  for (const reason of ['fuel', 'rubber', 'wood'] as const) {
    if (!shortages[reason]) {
      delete city.shortageSince[reason];
      continue;
    }
    city.shortageSince[reason] ??= now;
    if (
      now - city.shortageSince[reason]! < SHORTAGE_DELAY_MS ||
      (city.bountyCooldowns[reason] ?? 0) > now ||
      city.bounties.some(b => b.reason === reason)
    )
      continue;
    const resource = reason === 'fuel' ? (city.id === 'refinery' ? 'crude_oil' : 'petrol') : reason;
    const price = bountyPrice(city, resource),
      quantity = Math.min(BOUNTY_QUANTITY, Math.floor(spendingMoney(city, reason === 'fuel') / price));
    if (quantity < 1) continue;
    city.bounties.push({
      id: `${city.id}:${reason}:${now}`,
      resource,
      unitPrice: price,
      remaining: quantity,
      reservedCoins: quantity * price,
      createdAt: now,
      expiresAt: now + BOUNTY_LIFETIME_MS,
      reason,
    });
    city.bountyCooldowns[reason] = now + BOUNTY_LIFETIME_MS + BOUNTY_COOLDOWN_MS;
    event(data, city.id, 'bounty', `Mayor posted a funded ${resource.replaceAll('_', ' ')} delivery bounty.`);
  }
}
/** Applies a NEAR AI proposal. It can only change the mayor's bounded settings. */
export function applyMayorDecision(
  source: WorldData,
  cityId: CityId,
  proposal: Parameters<typeof boundedPolicy>[0],
): Transition {
  const data = initializeOwnership(structuredClone(source)),
    city = data.world.cities[cityId],
    policy = boundedPolicy(proposal, data.world.simulatedAt, 'near-ai');
  city.policy = policy;
  event(data, cityId, 'decision', policy.note);
  refreshCity(data, city);
  data.world.revision++;
  return {data, plan: null};
}
/** Advances one shared world. Gameplay and this settlement plan commit together into the durable outbox. */
export function advanceWorld(
  source: WorldData,
  now: number,
  operationId: string,
  options: {maxElapsedMs?: number} = {},
): Transition {
  const data = initializeOwnership(structuredClone(source)),
    w = data.world;
  if (!Number.isFinite(now) || now < w.updatedAt) return {data: source, plan: null};
  const elapsed = Math.min(now - w.updatedAt, options.maxElapsedMs ?? MAX_OFFLINE_MS);
  if (elapsed < SIM_TICK_MS) return {data: source, plan: null};
  const plan = newPlan(data, data.contractId, 'tick', now, operationId);
  const steps = Math.floor(elapsed / SIM_TICK_MS),
    start = w.simulatedAt;
  for (let i = 0; i < steps; i++) {
    const previous = w.simulatedAt;
    w.simulatedAt += SIM_TICK_MS;
    updateWorldEvent(data);
    for (const id of CITY_IDS) {
      const city = w.cities[id],
        completed = city.construction.filter(p => p.complete).length;
      city.fuelBurnRemainder +=
        (CITIES[id].fuelPerSecond + completed * BUILDING_FUEL_PER_SECOND) *
        fuelBurnRate(data, id) *
        (SIM_TICK_MS / 1000);
      const protectedFuel = id === 'refinery' ? CITIES.refinery.protectedFuel : 0;
      const used = Math.min(Math.floor(city.fuelBurnRemainder), Math.max(0, city.stock.petrol - protectedFuel));
      if (used) {
        city.stock.petrol -= used;
        burn(plan, city.accountId, 'petrol', used, 'fuel');
      }
      city.fuelBurnRemainder -= Math.floor(city.fuelBurnRemainder);
      for (const resource of RESOURCES) city.demand[resource] *= 0.997;
    }
    produce(data, plan, SIM_TICK_MS);
    if (Math.floor(previous / MAYOR_TRADE_INTERVAL_MS) !== Math.floor(w.simulatedAt / MAYOR_TRADE_INTERVAL_MS))
      mayorTrades(data, plan);
    const crossed = (interval: number) => Math.floor(previous / interval) !== Math.floor(w.simulatedAt / interval);
    if (crossed(IMPORT_INTERVAL_MS)) importFuel(data, plan);
    if (crossed(DRIVER_PAY_INTERVAL_MS)) for (const id of CITY_IDS) payDrivers(data, w.cities[id], plan);
    for (const id of CITY_IDS) refreshCity(data, w.cities[id]);
    // Presence timestamps are wall-clock values. The game clock can lag after a
    // capped offline catch-up, so comparing it directly with lastActiveAt would
    // permanently suppress later away earnings.
    const presenceTime = source.world.updatedAt + w.simulatedAt - start;
    advanceStations(data, plan, SIM_TICK_MS, presenceTime);
    advanceContracts(data, plan, presenceTime);
    for (const id of CITY_IDS) {
      refreshCity(data, w.cities[id]);
      bounties(data, w.cities[id]);
    }
    const previousDay = Math.floor((previous - w.createdAt) / DAY_LENGTH_MS),
      nextDay = Math.floor((w.simulatedAt - w.createdAt) / DAY_LENGTH_MS);
    if (nextDay !== previousDay) {
      for (const station of Object.values(w.stations)) {
        station.litresSoldToday = 0;
        station.revenueToday = 0;
      }
      // A NEAR AI decision stands for one day. After that the mayor's own rules return.
      for (const id of CITY_IDS) {
        const city = w.cities[id];
        if (city.policy.source === 'near-ai' && w.simulatedAt - city.policy.decidedAt < DAY_LENGTH_MS) continue;
        const next = rulePolicy(city, w);
        if (next.note !== city.policy.note) {
          city.policy = next;
          event(data, id, 'decision', next.note);
        }
      }
    }
  }
  w.day = 1 + Math.floor((w.simulatedAt - w.createdAt) / DAY_LENGTH_MS);
  w.dayFraction = ((w.simulatedAt - w.createdAt) / DAY_LENGTH_MS + INITIAL_DAY_FRACTION) % 1;
  // Discard excessively old offline backlog; retain only a sub-tick remainder.
  w.updatedAt = now - (elapsed - steps * SIM_TICK_MS);
  w.revision++;
  w.economyRevision++;
  // Empty updates never reach the chain. A mayor's new decision always does.
  const newDecision = CITY_IDS.some(id => !w.cities[id].policy.published);
  for (const id of CITY_IDS) w.cities[id].policy.published = true;
  plan.metadata = {
    elapsedMs: w.simulatedAt - start,
    tick: true,
    ...(newDecision ? {requiresSync: true} : {}),
    ...Object.fromEntries(CITY_IDS.map(id => ['price_' + id, w.cities[id].stationPrice])),
    mayorRecords: JSON.stringify(
      CITY_IDS.map(id => ({
        cityId: id,
        prices: w.cities[id].prices,
        reason: w.cities[id].competitionReason,
        marketShare: w.cities[id].marketShare,
        priceCap: w.cities[id].priceCap,
        decision: {
          note: w.cities[id].policy.note,
          source: w.cities[id].policy.source,
          bountyPremium: w.cities[id].policy.bountyPremium,
          wageRate: w.cities[id].policy.wageRate,
          fuelReserve: w.cities[id].policy.fuelReserve,
        },
        worldEvent: w.event?.kind ?? null,
        contracts: w.supplyContracts
          .filter(c => c.cityId === id && (c.status === 'active' || c.status === 'open'))
          .map(c => ({
            id: c.id,
            status: c.status,
            ownerId: c.ownerId,
            unitPrice: c.unitPrice,
            reservedCoins: c.reservedCoins,
            collateralHeld: c.collateralHeld,
            dueAt: c.dueAt,
          })),
      })),
    ),
  };
  assertLedger(data);
  return {data, plan: hasEffects(plan) ? plan : null};
}
