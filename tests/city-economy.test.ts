import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createWorld,
  registerPlayer,
  applyAction,
  advanceWorld,
  cargoCapacity,
  coinTotal,
  equipmentInstance,
  quoteTrade,
  assertLedger,
} from '../server/economy/index';
import {simulateWeek, createPreview, advancePreview} from '../server/economy/preview';
import {fuelState} from '../server/economy/citySim';
import {WorldStore} from '../server/world-store';
import {CITIES, DAY_LENGTH_MS, MAX_OFFLINE_MS} from '../shared/config/cities';
import {RESOURCE_NODES, CITY_TRADE_POINTS, CITY_START_POSITION} from '../shared/city-layout';
import type {GameAction, WorldData} from '../shared/game';

const now = 1800000000000,
  account = 'player.testnet';
const fresh = () =>
  createWorld({
    network: 'testnet',
    contractId: 'items.worldo.testnet',
    cityAccounts: {refinery: 'refinery.worldo.testnet', motor: 'motor.worldo.testnet', harbor: 'harbor.worldo.testnet'},
    now,
  });
const joined = () => registerPlayer(fresh(), account, now, 'join').data;
const at = (data: WorldData, city: 'refinery' | 'motor' | 'harbor') => {
  data.players[account].position = {...CITY_TRADE_POINTS[city]};
  return data;
};
const act = (data: WorldData, action: GameAction, time = now + 10000, id = 'action') =>
  applyAction(data, account, action, time, id);
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Unexpected temporary directory');
    await rm(dir, {recursive: true, force: true});
  }
});

describe('city economy', () => {
  it('honors the player’s displayed total-price limit and leaves source balances untouched when prices move against it', () => {
    const sale = at(joined(), 'refinery');
    sale.players[account].inventory.crude_oil = 4;
    sale.players[account].unminted.crude_oil = 4;
    const bid = quoteTrade(sale, 'refinery', 'crude_oil', 'sell', 4, undefined, account).total,
      beforeSale = JSON.stringify(sale);
    expect(() =>
      act(sale, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 4, limit: bid + 1}),
    ).toThrow(/price changed/);
    expect(JSON.stringify(sale)).toBe(beforeSale);
    const sold = act(sale, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 4, limit: bid}).data;
    expect(sold.players[account].coins - sale.players[account].coins).toBe(bid);
    const purchase = at(joined(), 'refinery'),
      ask = quoteTrade(purchase, 'refinery', 'petrol', 'buy', 2, undefined, account).total,
      beforePurchase = JSON.stringify(purchase);
    expect(() =>
      act(purchase, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: 2, limit: ask - 1}),
    ).toThrow(/price changed/);
    expect(JSON.stringify(purchase)).toBe(beforePurchase);
    const bought = act(purchase, {
      type: 'buy',
      cityId: 'refinery',
      resource: 'petrol',
      quantity: 2,
      limit: ask + 5,
    }).data;
    expect(purchase.players[account].coins - bought.players[account].coins).toBe(ask);
    expect(() =>
      act(purchase, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: 2, limit: Number.NaN}),
    ).toThrow(/positive whole number/);
  });
  it('grants starter coins from a finite pool and uniquely identifies equipment', () => {
    const source = fresh(),
      result = registerPlayer(source, account, now, 'join');
    expect(result.data.players[account].coins).toBe(100);
    expect(result.data.world.starterPool).toBe(99900);
    expect(coinTotal(result.data)).toBe(136000);
    expect(result.plan?.mints).toHaveLength(4);
    expect(result.plan?.mints.some(m => m.tokenId === 'coin')).toBe(false);
    expect(registerPlayer(result.data, account, now, 'second').plan).toBeNull();
    expect(source.players[account]).toBeUndefined();
  });
  it('requires a real account, rejects an unfunded grant and isolates deployment scopes', () => {
    expect(() => registerPlayer(fresh(), 'anonymous guest', now, 'join')).toThrow(/verified/);
    const data = fresh();
    data.world.starterPool = 0;
    data.world.initialCoinSupply -= 100000;
    expect(() => registerPlayer(data, account, now, 'join')).toThrow(/pool is empty/);
    expect(fresh().world.id).toBe('testnet:items.worldo.testnet');
  });
  it('lets a big order move the price and caps quantity by available treasury', () => {
    const data = joined(),
      one = quoteTrade(data, 'refinery', 'crude_oil', 'sell', 1),
      many = quoteTrade(data, 'refinery', 'crude_oil', 'sell', 100);
    expect(many.unitPrice).toBeLessThan(one.unitPrice);
    expect(many.lastUnitPrice).toBeLessThan(many.firstUnitPrice);
    expect(many.total).toBe(many.unitPrice * 100);
    data.world.cities.refinery.treasury = 20;
    const quote = quoteTrade(data, 'refinery', 'crude_oil', 'sell', 100);
    expect(quote.available).toBe(false);
    expect(quote.maxQuantity).toBeLessThan(100);
  });
  it('gathers only after server duration and at the correct node; completion cannot replay', () => {
    let data = joined();
    const node = RESOURCE_NODES[0];
    data.players[account].position = {x: node.position.x + 2, z: node.position.z};
    data = act(data, {type: 'gather_start', nodeId: node.id}, now + 1000).data;
    expect(() => act(data, {type: 'gather_finish'}, now + 1200)).toThrow(/Keep gathering/);
    data = act(data, {type: 'gather_finish'}, now + 3000).data;
    expect(data.players[account].inventory.crude_oil).toBe(1);
    expect(data.players[account].unminted.crude_oil).toBe(1);
    expect(() => act(data, {type: 'gather_finish'}, now + 5000)).toThrow(/Start gathering/);
    data.players[account].position = {x: 0, z: 0};
    expect(() => act(data, {type: 'gather_start', nodeId: node.id})).toThrow(/Walk to/);
  });
  it('keeps worn starter tools usable and powered equipment dependent on fuel', () => {
    let data = joined();
    const node = RESOURCE_NODES[0],
      player = data.players[account];
    player.position = {x: node.position.x + 2, z: node.position.z};
    player.equipment[0].durability = 0;
    data = act(data, {type: 'gather_start', nodeId: node.id}, now + 1000).data;
    expect(data.players[account].gathering?.durationMs).toBe(5400);
    data = act(data, {type: 'gather_finish'}, now + 7000).data;
    expect(data.players[account].inventory.crude_oil).toBe(1);
    const rig = equipmentInstance('oil_rig', 'rig');
    data.players[account].equipment.push(rig);
    data.players[account].equippedTools.crude_oil = rig.id;
    expect(() => act(data, {type: 'gather_start', nodeId: node.id}, now + 8000)).toThrow(/Refuel/);
  });
  it('mints gathered cargo at sale only, conserves coins and cannot sell it twice', () => {
    const data = at(joined(), 'refinery');
    data.players[account].inventory.crude_oil = 4;
    data.players[account].unminted.crude_oil = 4;
    const result = act(data, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 4});
    expect(result.plan?.mints).toEqual([
      {to: data.world.cities.refinery.accountId, tokenId: 'crude_oil', amount: 4, reason: 'harvest'},
    ]);
    expect(result.data.players[account].unminted.crude_oil).toBe(0);
    expect(coinTotal(result.data)).toBe(coinTotal(data));
    expect(() =>
      act(result.data, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 4}, now + 20000),
    ).toThrow(/cargo/);
  });
  it('rejects fractional, negative, remote and over-capacity trades', () => {
    const data = joined();
    expect(() => act(data, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: 1})).toThrow(/Enter/);
    at(data, 'refinery');
    expect(() => act(data, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: 0.5})).toThrow(/whole/);
    expect(() => act(data, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: 21})).toThrow(
      /cargo is full/,
    );
  });
  it('protects restart petrol, keeps emergency intake open in dark cities and allows recovery donations', () => {
    let data = at(joined(), 'refinery'),
      city = data.world.cities.refinery;
    city.stock.petrol = CITIES.refinery.protectedFuel;
    city.state = 'dark';
    expect(quoteTrade(data, 'refinery', 'petrol', 'buy', 1).available).toBe(false);
    data.players[account].inventory.crude_oil = 10;
    data.players[account].unminted.crude_oil = 10;
    data = act(data, {type: 'donate', cityId: 'refinery', resource: 'crude_oil', quantity: 10}).data;
    data = advanceWorld(data, now + 90000, 'recovery').data;
    expect(data.world.cities.refinery.stock.petrol).toBeGreaterThan(6);
  });
  it('runs all three production chains and funds repeated freight from city revenue', () => {
    const data = joined(),
      result = advanceWorld(data, now + 240000, 'tick');
    expect(result.plan?.burns.some(b => b.tokenId === 'crude_oil')).toBe(true);
    expect(result.data.world.cities.motor.equipmentInventory.length).toBeGreaterThan(0);
    expect(result.data.world.cities.harbor.construction[0].progress).toBeGreaterThan(0);
    expect(result.data.world.cities.harbor.freightEarned).toBeGreaterThan(0);
    expect(result.plan?.transfers.some(t => t.to === data.world.cities.harbor.accountId && t.tokenId === 'coin')).toBe(
      true,
    );
    expect(coinTotal(result.data)).toBe(coinTotal(data));
    assertLedger(result.data);
  });
  it('stalls construction and resumes the same plot when supplies arrive', () => {
    let data = joined();
    data.world.cities.harbor.stock.wood = 0;
    data = advanceWorld(data, now + 30000, 'stall').data;
    expect(data.world.cities.harbor.construction[0].stalled).toBe(true);
    expect(data.world.cities.harbor.construction[0].progress).toBe(0);
    data.world.cities.harbor.stock.wood = 80;
    data.world.cities.harbor.stock.rubber = 40;
    data.world.cities.harbor.stock.petrol = 100;
    data = advanceWorld(data, now + 270000, 'resume').data;
    expect(data.world.cities.harbor.construction[0].complete).toBe(true);
    expect(data.world.cities.harbor.construction[1].progress).toBeGreaterThan(0);
  });
  it('posts funded finite bounties after sustained shortage and expires reservations', () => {
    let data = joined();
    data.world.cities.harbor.stock.wood = 0;
    data = advanceWorld(data, now + 60000, 'shortage').data;
    const bounty = data.world.cities.harbor.bounties.find(b => b.resource === 'wood')!;
    expect(bounty).toBeDefined();
    expect(bounty.reservedCoins).toBe(bounty.remaining * bounty.unitPrice);
    at(data, 'harbor');
    data.players[account].inventory.wood = 20;
    data.players[account].unminted.wood = 20;
    expect(() =>
      act(
        data,
        {type: 'sell', cityId: 'harbor', resource: 'wood', quantity: bounty.remaining + 1, bountyId: bounty.id},
        now + 61000,
      ),
    ).toThrow(/bounty/);
    data = act(
      data,
      {type: 'sell', cityId: 'harbor', resource: 'wood', quantity: 5, bountyId: bounty.id},
      now + 61000,
    ).data;
    const reduced = data.world.cities.harbor.bounties.find(b => b.id === bounty.id)!;
    expect(reduced.remaining).toBe(15);
    expect(reduced.reservedCoins).toBe(15 * bounty.unitPrice);
    data = advanceWorld(data, now + 250000, 'expire').data;
    expect(data.world.cities.harbor.bounties.some(b => b.id === bounty.id)).toBe(false);
    expect(coinTotal(data)).toBe(136000);
  });
  it('blocks same-city emergency buyback arbitrage', () => {
    const data = at(joined(), 'motor');
    data.players[account].inventory.petrol = 1;
    data.players[account].purchases = [{cityId: 'motor', resource: 'petrol', quantity: 1, at: now}];
    data.world.cities.motor.bounties = [
      {
        id: 'emergency',
        resource: 'petrol',
        unitPrice: 30,
        remaining: 2,
        reservedCoins: 60,
        createdAt: now,
        expiresAt: now + 180000,
        reason: 'fuel',
      },
    ];
    expect(() =>
      act(data, {type: 'sell', cityId: 'motor', resource: 'petrol', quantity: 1, bountyId: 'emergency'}),
    ).toThrow(/buy back/);
  });
  it('uses fuel hysteresis and caps offline catchup without replaying the skipped interval', () => {
    expect(fuelState(10.5, 'dark')).toBe('dark');
    expect(fuelState(12.1, 'dark')).toBe('struggling');
    expect(fuelState(29, 'normal')).toBe('normal');
    const data = fresh(),
      later = now + 7 * 86400000,
      result = advanceWorld(data, later, 'offline');
    expect(result.data.world.simulatedAt - data.world.simulatedAt).toBe(MAX_OFFLINE_MS);
    expect(advanceWorld(result.data, later, 'repeat').plan).toBeNull();
  });
  it('charges repair to Motor, reduces the same item maximum durability and burns rubber', () => {
    const data = at(joined(), 'motor');
    data.players[account].equipment[0].durability = 5;
    const id = data.players[account].equipment[0].id;
    const result = act(data, {type: 'repair', equipmentId: id});
    expect(result.data.players[account].equipment[0].id).toBe(id);
    expect(result.data.players[account].equipment[0].maxDurability).toBe(90);
    expect(result.plan?.burns).toContainEqual({
      from: data.world.cities.motor.accountId,
      tokenId: 'rubber',
      amount: 1,
      reason: 'production',
    });
    expect(coinTotal(result.data)).toBe(136000);
  });
  it('retains raw-material provenance through warehouse round trips', () => {
    let data = at(joined(), 'harbor');
    const p = data.players[account];
    p.warehouseLevel = 1;
    p.storagePaidUntil = now + 999999;
    p.inventory.wood = 4;
    p.unminted.wood = 3;
    data = act(data, {type: 'storage', direction: 'deposit', resource: 'wood', quantity: 4}).data;
    expect(data.players[account].warehouseUnminted.wood).toBe(3);
    data = act(data, {type: 'storage', direction: 'withdraw', resource: 'wood', quantity: 4}, now + 20000).data;
    expect(data.players[account].unminted.wood).toBe(3);
    expect(data.players[account].warehouseUnminted.wood).toBe(0);
  });
  it('rejects impossible movement and does not refill distance credit per request', () => {
    let data = joined();
    expect(() => act(data, {type: 'move', position: {x: 0, z: 0}, heading: 0}, now + 100)).toThrow(/speed/);
    data = act(
      data,
      {type: 'move', position: {x: CITY_START_POSITION.x, z: CITY_START_POSITION.z + 1}, heading: 0},
      now,
    ).data;
    expect(() =>
      act(data, {type: 'move', position: {x: CITY_START_POSITION.x, z: CITY_START_POSITION.z + 2}, heading: 0}, now),
    ).toThrow(/speed/);
  });
  it('models tanker liquid capacity separately from solids', () => {
    const data = joined(),
      p = data.players[account],
      tanker = equipmentInstance('tanker', 'tanker');
    p.equipment.push(tanker);
    p.activeVehicleId = tanker.id;
    expect(cargoCapacity(p)).toBe(400);
    p.warehouseLevel = 1;
    p.warehouse.wood = 41;
    at(data, 'harbor');
    tanker.position = {...p.position};
    expect(() => act(data, {type: 'storage', direction: 'withdraw', resource: 'wood', quantity: 41})).toThrow(
      /40 solid/,
    );
  });
  it('forecasts a full game week in isolated frames with shortage, recovery and completed growth', () => {
    const data = joined(),
      before = JSON.stringify(data),
      frames = simulateWeek(data);
    expect(JSON.stringify(data)).toBe(before);
    expect(frames).toHaveLength(61);
    expect(frames.at(-1)!.elapsedMs).toBe(7 * DAY_LENGTH_MS);
    expect(frames.every(f => f.world.preview)).toBe(true);
    expect(frames.some(f => f.world.cities.harbor.state === 'dark')).toBe(true);
    expect(frames.some(f => f.world.cities.harbor.construction[0].stalled)).toBe(true);
    expect(frames.at(-1)!.world.cities.harbor.construction.some(p => p.complete)).toBe(true);
    expect(frames.some((f, i) => i > 20 && f.world.cities.harbor.state !== 'dark')).toBe(true);
  }, 20000);
  it('pauses supply in an interactive preview and lifts the same short city when enabled', () => {
    const source = joined(),
      initial = createPreview(source),
      short = advancePreview(initial, DAY_LENGTH_MS * 2, false);
    expect(short.world.cities.harbor.fuelPercent).toBeLessThan(35);
    expect(short.preview?.deliveries).toBe(0);
    const recovered = advancePreview(short, 140000, true);
    expect(recovered.world.cities.harbor.fuelPercent).toBeGreaterThan(short.world.cities.harbor.fuelPercent);
    expect(recovered.preview?.deliveries).toBe(1);
    expect(initial.world.revision).toBeGreaterThan(source.world.revision);
    expect(source.world.preview).toBe(false);
    expect(() => advancePreview(source, 140000, true)).toThrow(/isolated/);
  });
  it('makes every tick balance change exactly equal to its atomic chain effects', () => {
    const balances = (d: WorldData) => {
      const result: Record<string, number> = {};
      const add = (a: string, t: string, n: number) => {
        result[a + '|' + t] = (result[a + '|' + t] ?? 0) + n;
      };
      add(d.contractId, 'coin', d.world.starterPool);
      for (const c of Object.values(d.world.cities)) {
        add(c.accountId, 'coin', c.treasury);
        for (const [r, n] of Object.entries(c.stock)) add(c.accountId, r, n);
        for (const e of c.equipmentInventory) add(c.accountId, e.id, 1);
      }
      for (const p of Object.values(d.players)) {
        add(p.accountId, 'coin', p.coins);
        for (const r of ['crude_oil', 'petrol', 'rubber', 'wood'] as const)
          add(
            p.accountId,
            r,
            p.inventory[r] + p.warehouse[r] - (r === 'petrol' ? 0 : p.unminted[r] + p.warehouseUnminted[r]),
          );
        for (const e of p.equipment) add(p.accountId, e.id, 1);
      }
      return result;
    };
    let data = joined();
    for (let i = 1; i <= 12; i++) {
      const result = advanceWorld(data, now + i * 60000, 'ledger:' + i),
        expected = balances(data),
        actual = balances(result.data);
      const add = (a: string, t: string, n: number) => {
        const key = a + '|' + t;
        expected[key] = (expected[key] ?? 0) + n;
      };
      if (result.plan) {
        for (const t of result.plan.transfers) {
          add(t.from, t.tokenId, -t.amount);
          add(t.to, t.tokenId, t.amount);
        }
        for (const m of result.plan.mints) add(m.to, m.tokenId, m.amount);
        for (const b of result.plan.burns) add(b.from, b.tokenId, -b.amount);
      }
      expect(expected).toEqual(actual);
      expect(Object.values(actual).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
      data = result.data;
    }
  });
});

describe('durable shared-world storage', () => {
  it('queues bursts across store instances without rebuilding competing stale worlds or starving later actions', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'worldo-burst-'));
    directories.push(dir);
    const data = fresh(),
      scope = data.world.id;
    const stores = [new WorldStore(dir, ''), new WorldStore(path.relative(process.cwd(), dir), '')];
    await stores[0].create(scope, data);
    let builds = 0;
    const accounts = Array.from({length: 24}, (_, i) => `arrival-${i}.testnet`);
    await Promise.all(
      accounts.map((a, i) =>
        stores[i % 2].applyImmediate(
          scope,
          d => {
            builds++;
            return registerPlayer(d, a, now, 'arrival-' + i);
          },
          'arrival-' + i,
        ),
      ),
    );
    const saved = (await stores[0].get(scope))!;
    expect(Object.keys(saved.players).sort()).toEqual([...accounts].sort());
    expect(builds).toBe(accounts.length);
    expect(saved.world.starterPool).toBe(100000 - accounts.length * 100);
    expect((await stores[0].getChainStatus(scope)).queued).toBe(accounts.length);
    assertLedger(saved);
    const invalid = stores[0].applyImmediate(
      scope,
      () => {
        throw new Error('Rejected request fixture');
      },
      'invalid-request',
    );
    const valid = stores[1].applyImmediate(
      scope,
      d => registerPlayer(d, 'late.testnet', now, 'late-arrival'),
      'late-arrival',
    );
    const outcomes = await Promise.allSettled([invalid, valid]);
    expect(outcomes[0].status).toBe('rejected');
    expect(outcomes[1].status).toBe('fulfilled');
    expect((await stores[0].get(scope))!.players['late.testnet'].coins).toBe(100);
  }, 20000);
  it('preserves both concurrent registrations and one immutable outbox entry per newcomer after restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'worldo-city-'));
    directories.push(dir);
    const data = fresh(),
      scope = data.world.id;
    const store = new WorldStore(dir, '');
    await store.create(scope, data);
    const accounts = ['a.testnet', 'b.testnet'];
    await Promise.all(
      accounts.map((a, i) => store.applyImmediate(scope, d => registerPlayer(d, a, now, 'join' + i), 'join' + i)),
    );
    const restarted = new WorldStore(dir, ''),
      saved = (await restarted.get(scope))!;
    expect(Object.keys(saved.players).sort()).toEqual(accounts);
    expect(saved.world.starterPool).toBe(99800);
    expect(coinTotal(saved)).toBe(136000);
    const batch = (await restarted.claimBatch(scope))!;
    expect(batch.plans.map(p => p.id).sort()).toEqual(['join0', 'join1']);
    const repeat = await restarted.applyImmediate(scope, d => registerPlayer(d, accounts[0], now, 'join0'), 'join0');
    expect(repeat.duplicate).toBe(true);
    expect((await restarted.getChainStatus(scope)).queued).toBe(2);
  });
  it('rejects preview writes, deployment changes and confirmation of a batch that was never claimed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'worldo-city-'));
    directories.push(dir);
    const data = fresh(),
      scope = data.world.id,
      store = new WorldStore(dir, '');
    await store.create(scope, data);
    await expect(
      store.applyImmediate(
        scope,
        d => {
          d.world.preview = true;
          return {data: d, plan: null};
        },
        'preview',
      ),
    ).rejects.toThrow(/live world/);
    await expect(
      store.applyImmediate(
        scope,
        d => {
          d.contractId = 'different.testnet';
          return {data: d, plan: null};
        },
        'scope',
      ),
    ).rejects.toThrow(/live world/);
    await expect(
      store.confirmBatch(scope, 'batch:missing', {
        operationId: 'batch:missing',
        transactionHash: 'unit-test-hash',
        explorerUrl: 'https://testnet.nearblocks.io/txns/example',
        confirmedAt: now,
      }),
    ).rejects.toThrow(/matching batch/);
    expect(await store.get(scope)).toEqual(data);
    expect((await store.getChainStatus(scope)).queued).toBe(0);
  });
});
