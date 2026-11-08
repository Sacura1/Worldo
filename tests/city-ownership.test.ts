import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {GameAction, WorldData} from '../shared/game';
import {
  createWorld,
  registerPlayer,
  applyAction,
  advanceWorld,
  coinTotal,
  quoteTrade,
  assertLedger,
} from '../server/economy/index';
import {createPreview, advancePreview, previewSetPrice, PREVIEW_ACCOUNT} from '../server/economy/preview';
import {advanceStations} from '../server/economy/stations';
import {newPlan} from '../server/economy/ledger';
import {chooseStation} from '../server/economy/driverChoice';
import {refreshPrices, updateCompetition} from '../server/economy/pricingRules';
import {advanceContracts} from '../server/economy/contracts';
import {WorldStore} from '../server/world-store';
import {DAY_LENGTH_MS} from '../shared/config/cities';
import {STATION_BUILD_FEE, STATION_BUILD_WOOD} from '../shared/config/stations';
import {CITY_TRADE_POINTS} from '../shared/city-layout';
const now = 1800000000000,
  account = 'owner.testnet',
  plot = 'station:harbor:1';
function fresh() {
  return registerPlayer(
    createWorld({
      network: 'testnet',
      contractId: 'items.testnet',
      cityAccounts: {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'},
      now,
    }),
    account,
    now,
    'register',
  ).data;
}
function funded() {
  const data = fresh();
  data.players[account].coins += 2000;
  data.world.cities.motor.treasury -= 2000;
  data.players[account].position = {...data.world.stations[plot].position};
  return data;
}
function action(data: WorldData, a: GameAction, time = now, id = 'action') {
  return applyAction(data, account, a, time, id);
}
function built() {
  let data = action(funded(), {type: 'station_buy', stationId: plot, name: 'Owner Fuel'}).data;
  data.players[account].inventory.wood = STATION_BUILD_WOOD;
  data.players[account].unminted.wood = STATION_BUILD_WOOD;
  return action(data, {type: 'station_build', stationId: plot, quantity: STATION_BUILD_WOOD}).data;
}
function stocked() {
  let data = built();
  data.players[account].inventory.petrol = 100;
  data = action(data, {type: 'station_stock', stationId: plot, quantity: 100}).data;
  return action(data, {type: 'station_price', stationId: plot, price: 10}).data;
}
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, {recursive: true, force: true});
});
describe('owned station economy', () => {
  it('buys a unique deed with existing coins and limits one station per city', () => {
    const result = action(funded(), {type: 'station_buy', stationId: plot, name: 'Pump House'});
    expect(result.data.world.stations[plot].ownerId).toBe(account);
    expect(result.plan?.mints).toContainEqual({to: account, tokenId: plot, amount: 1, reason: 'manufacture'});
    expect(coinTotal(result.data)).toBe(136000);
    const second = 'station:harbor:2';
    result.data.players[account].position = {...result.data.world.stations[second].position};
    expect(() => action(result.data, {type: 'station_buy', stationId: second})).toThrow(/one station/);
    expect(() => action(result.data, {type: 'station_buy', stationId: 'constructor'})).toThrow(/does not exist/);
  });
  it('builds only as real wood arrives, charges its fee once, and accounts for harvested wood', () => {
    let data = action(funded(), {type: 'station_buy', stationId: plot}).data;
    data.players[account].inventory.wood = STATION_BUILD_WOOD;
    data.players[account].unminted.wood = STATION_BUILD_WOOD;
    const before = data.players[account].coins,
      part = STATION_BUILD_WOOD / 4;
    const first = action(data, {type: 'station_build', stationId: plot, quantity: part});
    expect(first.data.world.stations[plot].progress).toBeCloseTo(25);
    expect(first.plan?.mints[0].amount).toBe(part);
    expect(first.plan?.burns[0].amount).toBe(part);
    data = action(first.data, {type: 'station_build', stationId: plot, quantity: STATION_BUILD_WOOD - part}).data;
    expect(data.world.stations[plot].progress).toBe(100);
    expect(data.players[account].coins).toBe(before - STATION_BUILD_FEE);
    expect(data.players[account].unminted.wood).toBe(0);
    expect(() => action(data, {type: 'station_build', stationId: plot, quantity: 1})).toThrow(/already built/);
  });
  it('moves purchased petrol into locked station allocation without minting any fuel', () => {
    let data = built();
    data.players[account].inventory.petrol = 12;
    const result = action(data, {type: 'station_stock', stationId: plot, quantity: 12});
    expect(result.data.players[account].inventory.petrol).toBe(0);
    expect(result.data.world.stations[plot].tank).toBe(12);
    expect(result.plan?.mints).toHaveLength(0);
    expect(result.plan?.stationEffects).toEqual([{stationId: plot, ownerId: account, petrolDelta: 12}]);
    expect(result.plan).not.toBeNull();
  });
  it('protects ownership, proximity, price limits, tank capacity and hose materials', () => {
    let data = stocked();
    data.players[account].position = {x: 0, z: 0};
    expect(() => action(data, {type: 'station_price', stationId: plot, price: 10})).toThrow(/Visit/);
    data.players[account].position = {...data.world.stations[plot].position};
    expect(() => action(data, {type: 'station_price', stationId: plot, price: 61})).toThrow(/between/);
    data.world.stations[plot].pumpDurability = 70;
    expect(() => action(data, {type: 'station_repair', stationId: plot, quantity: 1})).toThrow(/cargo/);
    data.players[account].inventory.rubber = 2;
    data.players[account].unminted.rubber = 2;
    data = action(data, {type: 'station_repair', stationId: plot, quantity: 2}).data;
    expect(data.world.stations[plot].pumpDurability).toBe(94);
    expect(data.players[account].inventory.rubber).toBe(0);
  });
  it('scores price, queue and distance deterministically, and refuses unfunded fills', () => {
    const driver = fresh().world.cities.harbor.drivers[0];
    driver.coins = 100;
    driver.position = {x: 0, z: 0};
    const city = {
      id: 'city',
      position: {x: 10, z: 0},
      price: 20,
      queueLength: 0,
      availableLitres: 20,
      servingCapacity: 2,
      reputation: 0,
      playerOwned: false,
    };
    const rival = {...city, id: 'player', price: 14, playerOwned: true};
    expect(chooseStation(driver, [city, rival])?.id).toBe('player');
    expect(chooseStation(driver, [city, {...rival, queueLength: 10}])?.id).toBe('city');
    driver.coins = 1;
    expect(chooseStation(driver, [city, rival])).toBeNull();
  });
  it('a price cut reroutes an actual queued driver without teleporting or charging before arrival', () => {
    const data = stocked(),
      city = data.world.cities.harbor,
      station = data.world.stations[plot],
      driver = city.drivers[0];
    city.stock.petrol = 50;
    city.stationPrice = 40;
    station.price = 1;
    station.effectivePrice = 1;
    driver.phase = 'queued';
    driver.stationId = 'city:harbor';
    driver.readyAt = now;
    driver.position = {x: station.position.x + 25, z: station.position.z};
    const position = {...driver.position},
      coins = driver.coins,
      ownerCoins = data.players[account].coins,
      plan = newPlan(data, data.contractId, 'tick', now, 'reroute');
    data.world.simulatedAt = now + 5000;
    advanceStations(data, plan, 5000);
    expect(driver.previousStationId).toBe('city:harbor');
    expect(driver.stationId).toBe(plot);
    expect(driver.phase).toBe('travelling');
    expect(driver.position).toEqual(position);
    expect(driver.readyAt).toBeGreaterThan(data.world.simulatedAt);
    expect(driver.coins).toBe(coins);
    expect(data.players[account].coins).toBe(ownerCoins);
    expect(station.totalRevenue).toBe(0);
  });
  it('the mayor cuts its price after losing market share, explains it and keeps a replacement-cost floor', () => {
    const data = stocked(),
      city = data.world.cities.harbor;
    city.stock.petrol = 20;
    city.fuelCostBasis = 6;
    city.marketShareSales = 1;
    city.marketShareTotal = 20;
    refreshPrices(city);
    const before = city.stationPrice;
    for (let i = 0; i < 20; i++) {
      updateCompetition(data, city);
      refreshPrices(city);
    }
    expect(city.stationPrice).toBeLessThan(before);
    expect(city.stationPrice).toBeGreaterThan(city.fuelCostBasis);
    expect(city.competitionDiscount).toBeLessThanOrEqual(0.25);
    expect(city.competitionReason).toContain(String(city.stationPrice));
    expect(city.competitionReason).toContain('Losing customers');
  });
  it('earns offline from finite driver funds and transfers the city boost out of the actual tank', () => {
    const data = stocked(),
      city = data.world.cities.harbor,
      station = data.world.stations[plot];
    city.stock.petrol = 0;
    city.state = 'dark';
    const beforeCoins = coinTotal(data),
      beforeFuel = station.tank + city.stock.petrol,
      ownerCoins = data.players[account].coins;
    const plan = newPlan(data, data.contractId, 'tick', now, 'sales');
    for (let i = 1; i <= 18; i++) {
      data.world.simulatedAt = now + i * 5000;
      advanceStations(data, plan, 5000);
    }
    expect(station.totalLitresSold).toBeGreaterThan(0);
    expect(data.players[account].coins).toBeGreaterThan(ownerCoins);
    expect(data.players[account].offlineSummary.litresSold).toBe(station.totalLitresSold);
    const burnt = plan.burns
      .filter(b => b.tokenId === 'petrol' && (b.from === account || b.from === city.accountId))
      .reduce((n, b) => n + b.amount, 0);
    expect(station.tank + city.stock.petrol).toBe(beforeFuel - burnt);
    expect(coinTotal(data)).toBe(beforeCoins);
    expect(plan.stationEffects![0].petrolDelta).toBe(-station.totalLitresSold);
    assertLedger(data);
  });
  it('never lets an unfunded driver spend; production wages preserve protected funds', () => {
    const data = stocked();
    for (const city of Object.values(data.world.cities)) for (const driver of city.drivers) driver.coins = 0;
    const plan = newPlan(data, data.contractId, 'tick', now, 'no-budget');
    for (let i = 1; i <= 10; i++) {
      data.world.simulatedAt = now + i * 5000;
      advanceStations(data, plan, 5000);
    }
    expect(data.world.stations[plot].totalRevenue).toBe(0);
    expect(plan.transfers).toHaveLength(0);
  });
  it('keeps online sales out of the away summary while giving an absent owner the same earnings', () => {
    const online = stocked(),
      away = structuredClone(online);
    away.players[account].lastActiveAt = now - 60000;
    for (const data of [online, away]) {
      data.world.cities.harbor.stock.petrol = 0;
      data.world.cities.harbor.state = 'dark';
    }
    const onlinePlan = newPlan(online, online.contractId, 'tick', now, 'online'),
      awayPlan = newPlan(away, away.contractId, 'tick', now, 'away');
    for (let i = 1; i <= 18; i++) {
      const time = now + i * 5000;
      online.world.simulatedAt = time;
      away.world.simulatedAt = time;
      online.players[account].lastActiveAt = time;
      advanceStations(online, onlinePlan, 5000);
      advanceStations(away, awayPlan, 5000);
    }
    expect(away.world.stations[plot].totalRevenue).toBeGreaterThan(0);
    expect(online.world.stations[plot].totalRevenue).toBe(away.world.stations[plot].totalRevenue);
    expect(online.players[account].coins).toBe(away.players[account].coins);
    expect(online.players[account].offlineSummary.coinsEarned).toBe(0);
    expect(away.players[account].offlineSummary.coinsEarned).toBe(away.world.stations[plot].totalRevenue);
  });
  it('still counts away earnings when an earlier capped catch-up left the game clock behind wall time', () => {
    const data = stocked(),
      wallTime = now + 10 * 24 * 60 * 60 * 1000;
    data.world.updatedAt = wallTime;
    data.players[account].lastActiveAt = wallTime - 60000;
    const result = advanceWorld(data, wallTime + 90000, 'lagged-clock-tick').data;
    expect(result.world.simulatedAt).toBeLessThan(data.world.updatedAt);
    expect(result.players[account].offlineSummary.coinsEarned).toBeGreaterThan(0);
    expect(result.players[account].offlineSummary.coinsEarned).toBe(result.world.stations[plot].totalRevenue);
  });
  it('gouging changes reputation, raises a calm protest and applies an explicit temporary cap', () => {
    const data = stocked(),
      city = data.world.cities.harbor;
    city.state = 'dark';
    city.stock.petrol = 0;
    data.world.stations[plot].price = 60;
    for (const d of city.drivers) d.coins = 0;
    const plan = newPlan(data, data.contractId, 'tick', now, 'gouge');
    for (let i = 1; i <= 36; i++) {
      data.world.simulatedAt = now + i * 5000;
      advanceStations(data, plan, 5000);
    }
    expect(data.players[account].reputation.harbor).toBeLessThan(-10);
    expect(data.world.stations[plot].protest).toBeGreaterThan(0);
    expect(city.priceCap).not.toBeNull();
    expect(data.world.stations[plot].effectivePrice).toBeLessThan(60);
  });
  it('reputation changes both sides of quotes by at most ten percent', () => {
    const data = fresh(),
      base = quoteTrade(data, 'harbor', 'wood', 'sell', 1).unitPrice;
    data.players[account].reputation.harbor = 100;
    expect(quoteTrade(data, 'harbor', 'wood', 'sell', 1, undefined, account).unitPrice).toBe(Math.round(base * 1.1));
    const ask = quoteTrade(data, 'harbor', 'petrol', 'buy', 1).unitPrice;
    expect(quoteTrade(data, 'harbor', 'petrol', 'buy', 1, undefined, account).unitPrice).toBe(Math.round(ask * 0.9));
  });
  it('does not keep punishing historic market share after a station stops serving customers', () => {
    const data = stocked(),
      city = data.world.cities.harbor,
      station = data.world.stations[plot];
    station.tank = 0;
    station.totalLitresSold = 20;
    station.lastSaleAt = now - 60000;
    city.marketShareSales = 0;
    city.marketShareTotal = 20;
    for (const driver of city.drivers) driver.coins = 0;
    const reputation = data.players[account].reputation.harbor,
      plan = newPlan(data, data.contractId, 'tick', now, 'inactive');
    for (let i = 1; i <= 18; i++) {
      data.world.simulatedAt = now + i * 5000;
      advanceStations(data, plan, 5000);
    }
    expect(data.players[account].reputation.harbor).toBe(reputation);
  });
  it('the preview owns a real simulated deed, builds in stages, stocks and sells using the same rules', () => {
    const data = createPreview(fresh());
    const station = Object.values(data.world.stations).find(s => s.ownerId === PREVIEW_ACCOUNT)!;
    expect(station.progress).toBeGreaterThan(0);
    expect(station.progress).toBeLessThan(100);
    const advanced = advancePreview(data, DAY_LENGTH_MS * 3, true),
      finished = advanced.world.stations[station.id];
    expect(finished.progress).toBe(100);
    expect(finished.totalLitresSold).toBeGreaterThan(0);
    expect(coinTotal(advanced)).toBe(136000);
  });
  it('preview pricing remains isolated and later supply convoys keep the player’s chosen price', () => {
    const live = fresh(),
      before = JSON.stringify(live),
      preview = advancePreview(createPreview(live), DAY_LENGTH_MS * 3, true),
      station = Object.values(preview.world.stations).find(s => s.ownerId === PREVIEW_ACCOUNT)!;
    const changed = previewSetPrice(preview, station.id, 7),
      later = advancePreview(changed, 140000, true);
    expect(changed.world.stations[station.id].price).toBe(7);
    expect(later.world.stations[station.id].price).toBe(7);
    expect(preview.world.stations[station.id].price).not.toBe(7);
    expect(JSON.stringify(live)).toBe(before);
    expect(() => previewSetPrice(live, station.id, 7)).toThrow(/simulated station/);
  });
  it('always offers a construction and pricing scenario when every live station plot is owned', () => {
    let live = fresh();
    for (const [i, id] of Object.keys(live.world.stations).entries()) {
      const owner = `investor-${i}.testnet`;
      live = registerPlayer(live, owner, now, 'join:' + owner).data;
      live.players[owner].coins += 600;
      live.world.cities.motor.treasury -= 600;
      live.players[owner].position = {...live.world.stations[id].position};
      live = applyAction(live, owner, {type: 'station_buy', stationId: id}, now, 'buy:' + id).data;
    }
    assertLedger(live);
    expect(Object.values(live.world.stations).every(s => s.ownerId)).toBe(true);
    const before = JSON.stringify(live),
      preview = createPreview(live);
    const station = Object.values(preview.world.stations).find(s => s.ownerId === PREVIEW_ACCOUNT)!;
    expect(station).toBeDefined();
    expect(station.progress).toBeGreaterThan(0);
    expect(station.progress).toBeLessThan(100);
    expect(Object.keys(preview.players)).toEqual([PREVIEW_ACCOUNT]);
    expect(preview.contractId).toBe(live.contractId);
    expect(preview.world.cities.harbor.accountId).toBe(live.world.cities.harbor.accountId);
    expect(JSON.stringify(live)).toBe(before);
    assertLedger(preview);
  });
});
describe('funded supply contracts', () => {
  function offer() {
    const data = funded();
    data.world.simulatedAt = now + DAY_LENGTH_MS;
    const plan = newPlan(data, data.contractId, 'tick', now, 'offers');
    advanceContracts(data, plan);
    const contract = data.world.supplyContracts.find(c => c.cityId === 'harbor')!;
    data.world.simulatedAt += 30000;
    data.players[account].position = {...CITY_TRADE_POINTS.harbor};
    return {data, contract};
  }
  it('reserves every promised payment and locks bounded collateral at acceptance', () => {
    const {data, contract} = offer(),
      city = data.world.cities.harbor;
    expect(contract.reservedCoins).toBe(contract.quantityPerDay * contract.days * contract.unitPrice);
    expect(city.supplyReservedCoins).toBe(contract.reservedCoins);
    const accepted = action(data, {type: 'contract_accept', contractId: contract.id});
    expect(accepted.data.world.supplyContracts.find(c => c.id === contract.id)!.collateralHeld).toBeLessThanOrEqual(
      100,
    );
    expect(coinTotal(accepted.data)).toBe(136000);
    assertLedger(accepted.data);
  });
  it('defaults only the displayed collateral, releases undelivered reserves and lowers reputation', () => {
    let {data, contract} = offer();
    data = action(data, {type: 'contract_accept', contractId: contract.id}).data;
    const playerCoins = data.players[account].coins;
    const accepted = data.world.supplyContracts.find(c => c.id === contract.id)!;
    data.world.simulatedAt = accepted.dueAt!;
    advanceContracts(data, newPlan(data, data.contractId, 'tick', now, 'default'));
    expect(accepted.status).toBe('failed');
    expect(accepted.collateralHeld).toBe(0);
    expect(data.players[account].coins).toBe(playerCoins);
    expect(data.players[account].reputation.harbor).toBeLessThan(0);
    expect(coinTotal(data)).toBe(136000);
    assertLedger(data);
  });
  it('pays locked prices, rejects excess daily quantities and returns collateral after all three days', () => {
    let {data, contract} = offer();
    data = action(data, {type: 'contract_accept', contractId: contract.id}).data;
    const before = data.players[account].coins;
    for (let day = 0; day < 3; day++) {
      const current = data.world.supplyContracts.find(c => c.id === contract.id)!;
      data.players[account].inventory[current.resource] = current.quantityPerDay + 1;
      if (current.resource !== 'petrol') data.players[account].unminted[current.resource] = current.quantityPerDay + 1;
      expect(() =>
        action(data, {type: 'contract_deliver', contractId: current.id, quantity: current.quantityPerDay + 1}),
      ).toThrow(/remaining/);
      data = action(data, {type: 'contract_deliver', contractId: current.id, quantity: current.quantityPerDay}).data;
      if (day < 2) {
        data.world.simulatedAt = data.world.supplyContracts.find(c => c.id === contract.id)!.dueAt!;
        advanceContracts(data, newPlan(data, data.contractId, 'tick', now, 'next-day'));
      }
    }
    const complete = data.world.supplyContracts.find(c => c.id === contract.id)!;
    expect(complete.status).toBe('completed');
    expect(complete.reservedCoins).toBe(0);
    expect(data.players[account].coins).toBe(
      before + contract.quantityPerDay * 3 * contract.unitPrice + contract.collateral,
    );
    expect(data.players[account].reputation.harbor).toBeGreaterThan(0);
    assertLedger(data);
  });
});
describe('immediate game with durable batch outbox', () => {
  async function setup() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'worldo-outbox-'));
    directories.push(dir);
    const store = new WorldStore(dir, ''),
      data = fresh();
    await store.create(data.world.id, data);
    return {store, data, scope: data.world.id, dir};
  }
  it('commits gameplay instantly, permanently dedupes local-only economic actions and produces no fake receipt', async () => {
    const {store, scope} = await setup();
    const perform = (d: WorldData) => {
      d.players[account].position = {...CITY_TRADE_POINTS.refinery};
      d.players[account].inventory.crude_oil = 1;
      d.players[account].unminted.crude_oil = 1;
      return action(d, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 1}, now, 'sale');
    };
    const result = await store.applyImmediate(scope, perform, 'sale', false);
    expect(result.data.players[account].coins).toBeGreaterThan(100);
    expect(result.queued).toBe(false);
    expect(result.data.players[account].receipt).toBeUndefined();
    const duplicate = await store.applyImmediate(scope, perform, 'sale', false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.data.players[account].coins).toBe(result.data.players[account].coins);
    expect(await store.claimBatch(scope)).toBeNull();
  });
  it('persists the same batch across restart while newer gameplay continues and only acknowledges included actions', async () => {
    const {store, scope, dir} = await setup();
    const trade = (d: WorldData, id: string) => {
      d.players[account].position = {...CITY_TRADE_POINTS.refinery};
      d.players[account].inventory.crude_oil++;
      d.players[account].unminted.crude_oil++;
      return action(d, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 1}, now, id);
    };
    await store.applyImmediate(scope, d => trade(d, 'first'), 'first');
    const batch = (await store.claimBatch(scope))!;
    await store.applyImmediate(scope, d => trade(d, 'second'), 'second');
    const restarted = new WorldStore(dir, '');
    expect(await restarted.claimBatch(scope)).toEqual(batch);
    expect((await restarted.getChainStatus(scope)).queued).toBe(2);
    await restarted.recordBatchFailure(scope, batch.id);
    expect((await restarted.getChainStatus(scope)).pendingBatch?.id).toBe(batch.id);
    const receipt = {
      operationId: batch.id,
      transactionHash: 'verified-unit-test-hash',
      explorerUrl: 'https://testnet.nearblocks.io/txns/example',
      confirmedAt: now,
    };
    await restarted.confirmBatch(scope, batch.id, receipt);
    await restarted.confirmBatch(scope, batch.id, receipt);
    expect((await restarted.getChainStatus(scope)).queued).toBe(1);
    const next = (await restarted.claimBatch(scope))!;
    expect(next.previousSequence).toBe(batch.sequence);
    expect(next.plans.map(p => p.id)).toEqual(['second']);
    expect((await restarted.get(scope))!.players[account].coins).toBeGreaterThan(100);
  }, 20000);
});
