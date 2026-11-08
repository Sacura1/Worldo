import {describe, expect, it} from 'vitest';
import type {SettlementPlan, WorldData} from '../shared/game';
import {
  applyAction,
  advanceWorld,
  assertLedger,
  coinTotal,
  createWorld,
  quoteTrade,
  registerPlayer,
} from '../server/economy/index';
import {simulateWeek} from '../server/economy/preview';
import {POLICY_LIMITS, boundedPolicy} from '../server/economy/mayorPolicy';
import {unitPrice} from '../server/economy/pricingRules';
import {compactOutbox} from '../shared/batches';
import {CITY_IDS, DAY_LENGTH_MS, SIM_TICK_MS} from '../shared/config/cities';
import {WORLD_EVENT_KINDS, nextWorldEvent} from '../shared/config/events';
import {STATION_BUILD_WOOD} from '../shared/config/stations';
import {CITY_TRADE_POINTS, RESOURCE_NODES} from '../shared/city-layout';

const now = 1800000000000;
const contractId = 'worldo.testnet';
const cities = {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'};
const cityAccounts = Object.values(cities);
const fresh = () => createWorld({network: 'testnet', contractId, cityAccounts: cities, now});
const runTicks = (start: WorldData, count: number, from = now, onPlan?: (plan: SettlementPlan) => void) => {
  let data = start;
  let clock = from;
  for (let tick = 0; tick < count; tick++) {
    clock += SIM_TICK_MS;
    const result = advanceWorld(data, clock, `tick:${tick}`);
    data = result.data;
    if (result.plan) onPlan?.(result.plan);
  }
  return {data, clock};
};

/** Mirrors the tick rules in contracts/src/lib.rs. The deployed contract is not
 * changing, so every tick the new economy produces must already be legal there. */
function assertContractAcceptsTick(plan: SettlementPlan, players: Record<string, unknown>) {
  const isCity = (id: string) => cityAccounts.includes(id);
  const registered = (id: string) => Object.hasOwn(players, id);
  const stationOwners = new Set((plan.stationEffects ?? []).map(effect => effect.ownerId));
  for (const effect of plan.stationEffects ?? [])
    expect(effect.petrolDelta, 'a tick may only sell allocated fuel').toBeLessThan(0);
  for (const transfer of plan.transfers) {
    const cityTransfer =
      isCity(transfer.from) && (isCity(transfer.to) || transfer.to === contractId || registered(transfer.to));
    const driverPayment =
      transfer.from === contractId && transfer.tokenId === 'coin' && (isCity(transfer.to) || registered(transfer.to));
    const stationDelivery = stationOwners.has(transfer.from) && isCity(transfer.to) && transfer.tokenId === 'petrol';
    expect(cityTransfer || driverPayment || stationDelivery, JSON.stringify(transfer)).toBe(true);
  }
  for (const mint of plan.mints) {
    expect(mint.tokenId).not.toBe('coin');
    expect(mint.reason, JSON.stringify(mint)).toBe('manufacture');
    expect(
      isCity(mint.to) && (mint.tokenId === 'petrol' || mint.tokenId.startsWith('equipment:')),
      JSON.stringify(mint),
    ).toBe(true);
  }
  for (const burn of plan.burns) {
    expect(['fuel', 'production', 'construction']).toContain(burn.reason);
    expect(isCity(burn.from) || (burn.tokenId === 'petrol' && stationOwners.has(burn.from)), JSON.stringify(burn)).toBe(
      true,
    );
  }
  expect(
    plan.transfers.length + plan.mints.length + plan.burns.length + (plan.stationEffects?.length ?? 0),
  ).toBeLessThanOrEqual(128);
}

describe('a world that stays alive', {timeout: 60000}, () => {
  it('keeps every city alive and solvent for a whole day with nobody playing', () => {
    let darkTicks = 0;
    const start = fresh();
    const bestRecentFuel = Object.fromEntries(CITY_IDS.map(id => [id, 0]));
    let data = start;
    let clock = now;
    for (let tick = 0; tick < 17280; tick++) {
      clock += SIM_TICK_MS;
      data = advanceWorld(data, clock, `tick:${tick}`).data;
      darkTicks += CITY_IDS.filter(id => data.world.cities[id].state === 'dark').length;
      if (tick > 17280 - 720)
        for (const id of CITY_IDS) bestRecentFuel[id] = Math.max(bestRecentFuel[id], data.world.cities[id].fuelPercent);
    }
    expect(darkTicks / (17280 * 3)).toBeLessThan(0.25);
    for (const id of CITY_IDS) {
      expect(bestRecentFuel[id]).toBeGreaterThan(15);
      expect(data.world.cities[id].treasury).toBeGreaterThan(5000);
    }
    expect(coinTotal(data)).toBe(coinTotal(start));
    assertLedger(data);
    // A whole simulated day takes about 40 seconds, and longer on a busy machine.
  }, 180000);

  it('never queues an update that changes nothing', () => {
    runTicks(fresh(), 720, now, plan => {
      const effects =
        plan.transfers.length + plan.mints.length + plan.burns.length + (plan.stationEffects?.length ?? 0);
      expect(effects > 0 || plan.metadata.requiresSync === true).toBe(true);
    });
  });

  it('produces only ticks the deployed contract already accepts', () => {
    let data = fresh();
    const owner = 'owner.testnet';
    data = registerPlayer(data, owner, now, 'register').data;
    data.world.starterPool -= 1000;
    data.players[owner].coins += 1000;
    const stationId = 'station:harbor:1';
    data.players[owner].position = {...data.world.stations[stationId].position};
    data = applyAction(data, owner, {type: 'station_buy', stationId}, now, 'buy').data;
    data.players[owner].inventory.wood = STATION_BUILD_WOOD;
    data.players[owner].unminted.wood = STATION_BUILD_WOOD;
    data = applyAction(
      data,
      owner,
      {type: 'station_build', stationId, quantity: STATION_BUILD_WOOD},
      now,
      'build',
    ).data;
    data.players[owner].inventory.petrol = 300;
    data = applyAction(data, owner, {type: 'station_stock', stationId, quantity: 300}, now, 'stock').data;
    let ticks = 0;
    runTicks(data, 2160, now, plan => {
      ticks++;
      assertContractAcceptsTick(plan, data.players);
    });
    expect(ticks).toBeGreaterThan(500);
  });

  it('pays for imported fuel with real coins and moves no coins out of existence', () => {
    let data = fresh();
    const total = coinTotal(data);
    data.world.cities.harbor.stock.petrol = 2;
    data.world.nextEventAt = now + 10 * DAY_LENGTH_MS;
    let imported = 0;
    ({data} = runTicks(data, 24, now, plan => {
      imported += plan.mints
        .filter(mint => mint.tokenId === 'petrol' && mint.to === cities.harbor)
        .reduce((sum, mint) => sum + mint.amount, 0);
    }));
    expect(imported).toBeGreaterThan(0);
    expect(data.world.cities.harbor.importedLitres).toBe(imported);
    expect(coinTotal(data)).toBe(total);
  });

  it('stops imports during a storm', () => {
    let data = fresh();
    data.world.cities.harbor.stock.petrol = 2;
    data.world.event = {id: 'event:test', kind: 'storm', startedAt: now, endsAt: now + DAY_LENGTH_MS};
    data.world.nextEventAt = now + 10 * DAY_LENGTH_MS;
    ({data} = runTicks(data, 48));
    expect(data.world.cities.harbor.importedLitres).toBe(0);
  });

  it('changes by itself: events run, and they follow a repeatable order', () => {
    const {data} = runTicks(fresh(), 2400);
    expect(data.world.eventCount).toBeGreaterThanOrEqual(3);
    expect(data.world.events.some(event => event.type === 'world')).toBe(true);
    const first = nextWorldEvent('world', 3);
    expect(nextWorldEvent('world', 3)).toEqual(first);
    expect(WORLD_EVENT_KINDS).toContain(first.kind);
    for (let index = 0; index < 40; index++) expect(nextWorldEvent('world', index, 'storm').kind).not.toBe('storm');
  });

  it('keeps moving through the second half of a fast-forward week', () => {
    const frames = simulateWeek(fresh(), 60).slice(30);
    for (const id of CITY_IDS) {
      const fuel = frames.map(frame => frame.world.cities[id].fuelPercent);
      expect(Math.max(...fuel) - Math.min(...fuel), id).toBeGreaterThan(8);
    }
    const sold = frames.map(frame =>
      Object.values(frame.world.stations).reduce((sum, station) => sum + station.totalLitresSold, 0),
    );
    expect(sold.at(-1)!).toBeGreaterThan(sold[0]);
  });
});

describe('small fixes that protect the chain and the market', () => {
  it('settles a gift of mined goods as a sale so the contract accepts it', () => {
    let data = registerPlayer(fresh(), 'alice.testnet', now, 'register').data;
    const node = RESOURCE_NODES.find(candidate => candidate.resource === 'crude_oil')!;
    data.players['alice.testnet'].position = {x: node.position.x + 1.5, z: node.position.z};
    data = applyAction(data, 'alice.testnet', {type: 'gather_start', nodeId: node.id}, now + 1, 'start').data;
    data = applyAction(data, 'alice.testnet', {type: 'gather_finish'}, now + 2000, 'finish').data;
    data.players['alice.testnet'].position = {...CITY_TRADE_POINTS.refinery};
    const {plan} = applyAction(
      data,
      'alice.testnet',
      {type: 'donate', cityId: 'refinery', resource: 'crude_oil', quantity: 1},
      now + 3000,
      'gift',
    );
    expect(plan?.action).toBe('sell');
    expect(plan?.mints).toEqual([{to: cities.refinery, tokenId: 'crude_oil', amount: 1, reason: 'harvest'}]);
    expect(plan?.transfers).toEqual([]);
  });

  it('makes flooding a market cheaper inside the same order', () => {
    const data = fresh();
    data.world.cities.refinery.stock.crude_oil = 60;
    const small = quoteTrade(data, 'refinery', 'crude_oil', 'sell', 1);
    const flood = quoteTrade(data, 'refinery', 'crude_oil', 'sell', 300);
    expect(flood.unitPrice).toBeLessThan(small.unitPrice);
    expect(flood.lastUnitPrice).toBeLessThan(flood.firstUnitPrice);
  });

  it('moves the price with an ordinary cart, even in a city that has run dry', () => {
    const data = fresh();
    data.world.cities.refinery.stock.crude_oil = 0;
    const cart = quoteTrade(data, 'refinery', 'crude_oil', 'sell', 20);
    expect(cart.lastUnitPrice).toBeLessThan(cart.firstUnitPrice);
  });

  it('lowers a price with every delivery until the city reaches its target', () => {
    const city = fresh().world.cities.refinery;
    const prices = [0, 20, 40, 60, 80].map(crude_oil =>
      unitPrice({...city, stock: {...city.stock, crude_oil}}, 'crude_oil', 'buy'),
    );
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThan(prices[i - 1]);
  });

  it('lets a mayor tilt everyday prices, only inside the limit', () => {
    const city = fresh().world.cities.motor;
    const steady = unitPrice(city, 'petrol', 'buy');
    city.policy.priceRate = POLICY_LIMITS.priceRate.max;
    expect(unitPrice(city, 'petrol', 'buy')).toBeGreaterThan(steady);
    city.policy.priceRate = POLICY_LIMITS.priceRate.min;
    expect(unitPrice(city, 'petrol', 'buy')).toBeLessThan(steady);
  });

  it('gives a world saved before the price setting a neutral rate', () => {
    const data = fresh();
    delete (data.world.cities.motor.policy as {priceRate?: number}).priceRate;
    expect(advanceWorld(data, now + SIM_TICK_MS, 'tick:old-save').data.world.cities.motor.policy.priceRate).toBe(1);
  });

  it('never lets a mayor decision leave its limits', () => {
    const wild = boundedPolicy(
      {
        bountyPremium: 90,
        wageRate: -4,
        fuelReserve: 1000,
        priceRate: 9,
        note: `  raise <b>wages</b>\n${'x'.repeat(500)}`,
      },
      now,
      'near-ai',
    );
    expect(wild.bountyPremium).toBe(POLICY_LIMITS.bountyPremium.max);
    expect(wild.wageRate).toBe(POLICY_LIMITS.wageRate.min);
    expect(wild.fuelReserve).toBe(POLICY_LIMITS.fuelReserve.max);
    expect(wild.priceRate).toBe(POLICY_LIMITS.priceRate.max);
    expect(wild.note.length).toBeLessThanOrEqual(160);
    expect(wild.note).not.toMatch(/[<>]/);
    expect(boundedPolicy({bountyPremium: Number.NaN}, now, 'near-ai').bountyPremium).toBe(1.5);
  });

  it('merges neighbouring city updates without changing totals or player order', () => {
    const tick = (id: string, nonce: number, amount: number): SettlementPlan => ({
      id,
      accountId: contractId,
      action: 'tick',
      nonce,
      createdAt: now,
      expiresAt: now + 1,
      metadata: {elapsedMs: 5000},
      transfers: [{from: cities.harbor, to: contractId, tokenId: 'coin', amount}],
      mints: [],
      burns: [{from: cities.harbor, tokenId: 'petrol', amount, reason: 'fuel'}],
      stationEffects: [{stationId: 'station:harbor:1', ownerId: 'owner.testnet', petrolDelta: -amount}],
    });
    const player: SettlementPlan = {
      id: 'player-action',
      accountId: 'alice.testnet',
      action: 'sell',
      nonce: 2,
      createdAt: now,
      expiresAt: now + 1,
      metadata: {},
      transfers: [],
      mints: [],
      burns: [],
      stationEffects: [],
    };
    const merged = compactOutbox([tick('tick:1', 1, 2), tick('tick:2', 2, 3), player, tick('tick:3', 3, 4)]);
    expect(merged.map(plan => plan.id)).toEqual(['tick:2', 'player-action', 'tick:3']);
    expect(merged[0].nonce).toBe(2);
    expect(merged[0].transfers[0].amount).toBe(5);
    expect(merged[0].burns[0].amount).toBe(5);
    expect(merged[0].stationEffects?.[0].petrolDelta).toBe(-5);
    expect(merged[0].metadata.elapsedMs).toBe(10000);
  });
});
