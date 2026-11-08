import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {KeyPair} from '@near-js/crypto';
import type {SettlementPlan, WorldData} from '../shared/game';
import {advanceWorld, createWorld, registerPlayer, snapshot} from '../server/economy/index';
import {applyMayorDecision} from '../server/economy/citySim';
import {MayorCouncil} from '../server/mayor-council';
import {NpcProviders} from '../server/npc-providers';
import {checkNpcProximity, npcMessages, scriptedMayorReply} from '../server/npc';
import {WorldStore} from '../server/world-store';
import {createReadinessChecker} from '../server/production-readiness';
import {guestPlayEnabled} from '../server/near-config';
import {currentGoal} from '../src/city/goals';
import {STATION_BUILD_WOOD, STATION_PLOT_PRICE, STATION_BUILD_FEE} from '../shared/config/stations';
import {MAYORS} from '../shared/mayors';
import {messages} from '../src/lib/i18n';
import {LANGUAGES} from '../shared/languages';

const now = 1800000000000;
const account = 'alice.testnet';
const contractId = 'worldo.testnet';
const world = () =>
  createWorld({
    network: 'testnet',
    contractId,
    cityAccounts: {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'},
    now,
  });
const joined = () => registerPlayer(world(), account, now, 'register').data;
const tickPlan = (id: string, nonce: number): SettlementPlan => ({
  id,
  accountId: contractId,
  action: 'tick',
  nonce,
  createdAt: now,
  expiresAt: now + 1,
  metadata: {elapsedMs: 5000},
  transfers: [{from: 'harbor.testnet', to: contractId, tokenId: 'coin', amount: 1}],
  mints: [],
  burns: [],
  stationEffects: [],
});
const playerPlan = (id: string, nonce: number): SettlementPlan => ({
  ...tickPlan(id, nonce),
  accountId: account,
  action: 'sell',
  transfers: [],
});

describe('first goals', () => {
  it('leads a new player from crude to a working station', () => {
    const data = joined();
    const state = () => snapshot(data, account);
    const player = data.players[account];
    expect(currentGoal(state())).toMatchObject({step: 1, title: 'Gather crude oil'});
    player.inventory.crude_oil = 12;
    expect(currentGoal(state())).toMatchObject({step: 2, title: 'Sell to the mayor'});
    player.inventory.crude_oil = 0;
    player.coins = STATION_PLOT_PRICE + STATION_BUILD_FEE;
    expect(currentGoal(state())).toMatchObject({step: 3, title: 'Buy a station plot'});
    const station = Object.values(data.world.stations)[0];
    station.ownerId = account;
    expect(currentGoal(state())).toMatchObject({step: 4, title: 'Bring wood to your station'});
    player.inventory.wood = 5;
    expect(currentGoal(state())?.target).toEqual(station.position);
    station.progress = 100;
    expect(currentGoal(state())).toMatchObject({step: 5, title: 'Stock your pump'});
    station.tank = 20;
    expect(currentGoal(state())).toMatchObject({title: 'Set your price'});
    station.totalLitresSold = 3;
    expect(currentGoal(state())).toBeNull();
  });

  it('has a translation for every goal in every language', () => {
    const titles = [
      'Gather crude oil',
      'Sell to the mayor',
      'Buy a station plot',
      'Bring wood to your station',
      'Deliver your wood',
      'Stock your pump',
      'Unload your petrol',
      'Set your price',
      'Play as guest',
    ];
    for (const {code} of LANGUAGES)
      for (const title of titles) expect(messages[code][title], `${code}: ${title}`).toBeTruthy();
  });
});

describe('mayor decisions', () => {
  const council = (reply: string) => {
    const providers = {chat: vi.fn(async () => reply)} as unknown as NpcProviders;
    const instance = new MayorCouncil(providers);
    vi.spyOn(instance, 'available').mockReturnValue(true);
    return {instance, providers};
  };

  it('reads a NEAR AI proposal, and the economy clamps it', async () => {
    process.env.NEAR_AI_API_KEY = 'fixture';
    const {instance} = council(
      'Thinking done. {"bountyPremium":9,"wageRate":0.1,"fuelReserve":12,"note":"Pay more for fuel."}',
    );
    const data = joined();
    const proposal = await instance.propose(data, 'refinery');
    expect(proposal).not.toBeNull();
    const {data: next, plan} = applyMayorDecision(data, 'refinery', proposal!);
    const policy = next.world.cities.refinery.policy;
    expect(plan).toBeNull();
    expect(policy).toMatchObject({
      bountyPremium: 2,
      wageRate: 0.6,
      fuelReserve: 12,
      source: 'near-ai',
      note: 'Pay more for fuel.',
    });
    expect(next.world.events.at(-1)).toMatchObject({type: 'decision', message: 'Pay more for fuel.'});
    delete process.env.NEAR_AI_API_KEY;
  });

  it('ignores a reply that is not a usable decision', async () => {
    process.env.NEAR_AI_API_KEY = 'fixture';
    expect(await council('I would rather not answer.').instance.propose(joined(), 'motor')).toBeNull();
    expect(await council('{"bountyPremium":1.4}').instance.propose(joined(), 'motor')).toBeNull();
    delete process.env.NEAR_AI_API_KEY;
  });

  it('publishes a new decision in the next tick, even if nothing else changed', () => {
    const data = applyMayorDecision(joined(), 'harbor', {note: 'Holding steady.', wageRate: 1}).data;
    const {plan, data: next} = advanceWorld(data, now + 5000, 'tick:decision');
    expect(plan?.metadata.requiresSync).toBe(true);
    expect(JSON.parse(String(plan?.metadata.mayorRecords))[2].decision).toMatchObject({
      note: 'Holding steady.',
      source: 'near-ai',
    });
    expect(next.world.cities.harbor.policy.published).toBe(true);
  });
});

describe('mayors with no AI', () => {
  const context = () => {
    const data = joined();
    const npc = MAYORS.find(mayor => mayor.cityId === 'refinery')!;
    return {npc, state: snapshot(data, account)};
  };

  it('answers from live game facts', () => {
    const facts = context();
    expect(scriptedMayorReply(facts, 'Why did your price change?')).toContain(
      `${facts.state.world.cities.refinery.stationPrice} coins`,
    );
    expect(scriptedMayorReply(facts, 'Where should I go next?')).toContain('Oil Field');
    expect(scriptedMayorReply(facts, 'What does your city need?')).toContain('crude oil');
    expect(
      messages.fr['My city needs {resource} most. We hold {stock} and want {target}. Fuel is at {fuel}%.'],
    ).toBeTruthy();
    expect(npcMessages).toBeTypeOf('function');
    expect(checkNpcProximity).toBeTypeOf('function');
  });
});

describe('settlement queue', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));
  });
  async function storeWith(plans: SettlementPlan[]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'worldo-queue-'));
    directories.push(directory);
    const store = new WorldStore(directory, '');
    const seed: WorldData = world();
    await store.create(seed.world.id, seed);
    for (const plan of plans) await store.applyImmediate(seed.world.id, current => ({data: current, plan}), plan.id);
    return {store, scope: seed.world.id};
  }

  it('merges waiting city updates and lets them wait for a player action', async () => {
    const {store, scope} = await storeWith([tickPlan('tick:a', 1), tickPlan('tick:b', 2)]);
    const first = await store.claimBatch(scope, 20, {tickOnlyIntervalMs: 300000});
    expect(first?.plans).toHaveLength(1);
    expect(first?.plans[0].transfers[0].amount).toBe(2);
    await store.confirmBatch(scope, first!.id, {
      operationId: first!.id,
      transactionHash: 'hash',
      explorerUrl: 'https://example.test/hash',
      confirmedAt: now,
    });
    await store.applyImmediate(scope, current => ({data: current, plan: tickPlan('tick:c', 3)}), 'tick:c');
    expect(await store.claimBatch(scope, 20, {tickOnlyIntervalMs: 300000})).toBeNull();
    await store.applyImmediate(scope, current => ({data: current, plan: playerPlan('player:a', 1)}), 'player:a');
    expect((await store.claimBatch(scope, 20, {tickOnlyIntervalMs: 300000}))?.plans.map(plan => plan.id)).toEqual([
      'tick:c',
      'player:a',
    ]);
  });

  it('finds and skips one refused action so everyone else can continue', async () => {
    const {store, scope} = await storeWith([playerPlan('player:good', 1), playerPlan('player:bad', 2)]);
    let batch = (await store.claimBatch(scope))!;
    expect(batch.plans).toHaveLength(2);
    await store.splitRejectedBatch(scope, batch.id);
    batch = (await store.claimBatch(scope))!;
    expect(batch.plans.map(plan => plan.id)).toEqual(['player:good']);
    await store.confirmBatch(scope, batch.id, {
      operationId: batch.id,
      transactionHash: 'hash',
      explorerUrl: 'https://example.test/hash',
      confirmedAt: now,
    });
    batch = (await store.claimBatch(scope))!;
    expect(batch.plans.map(plan => plan.id)).toEqual(['player:bad']);
    for (let attempt = 0; attempt < 3; attempt++) await store.splitRejectedBatch(scope, batch.id);
    expect(await store.claimBatch(scope)).toBeNull();
    expect((await store.getChainStatus(scope)).queued).toBe(0);
  });
});

describe('guest play settings', () => {
  it('stays off unless switched on, and is never available on mainnet', () => {
    expect(guestPlayEnabled({NEAR_NETWORK: 'testnet'})).toBe(false);
    expect(guestPlayEnabled({NEAR_NETWORK: 'testnet', GUEST_PLAY_ENABLED: 'true'})).toBe(true);
    expect(guestPlayEnabled({NEAR_NETWORK: 'mainnet', GUEST_PLAY_ENABLED: 'true'})).toBe(false);
  });

  it('does not let an unapproved login domain stop a guest-enabled testnet world', async () => {
    const key = KeyPair.fromRandom('ed25519').toString();
    const env = {
      NEAR_NETWORK: 'testnet',
      ENABLE_TESTNET: 'true',
      PUBLIC_URL: 'https://worldo.world',
      NEAR_AUTH_MODE: 'social',
      LOCAL_DATA_DIR: '.local/fixture',
      TESTNET_SINGLE_PROCESS: 'true',
      NEAR_CONTRACT_ID: 'worldo.testnet',
      NEAR_RELAYER_ACCOUNT_ID: 'relay.testnet',
      NEAR_RELAYER_PRIVATE_KEY: key,
      NEAR_RELAYER_DAILY_BUDGET_YOCTO: '1000',
      NEAR_RELAYER_SIGN_DEPOSIT_YOCTO: '1',
      NEAR_ORACLE_ACCOUNT_ID: 'oracle.testnet',
      NEAR_ORACLE_PRIVATE_KEY: key,
      NEAR_REFINERY_ACCOUNT: 'r.testnet',
      NEAR_MOTOR_ACCOUNT: 'm.testnet',
      NEAR_HARBOR_ACCOUNT: 'h.testnet',
      NEAR_REFINERY_PRIVATE_KEY: key,
      NEAR_MOTOR_PRIVATE_KEY: key,
      NEAR_HARBOR_PRIVATE_KEY: key,
    };
    const probes = {
      database: async () => {},
      localStorage: async () => {},
      chain: async () => {},
      gameplay: async () => {},
      auth: async () => {
        throw new Error('This origin is not allowed.');
      },
    };
    expect((await createReadinessChecker(probes).refresh(env)).ready).toBe(false);
    const guests = await createReadinessChecker(probes).refresh({...env, GUEST_PLAY_ENABLED: 'true'});
    expect(guests).toMatchObject({ready: true, accountReady: true});
  });
});

it('keeps the first station within reach of a short play session', () => {
  expect(STATION_BUILD_WOOD).toBeLessThanOrEqual(40);
  expect(STATION_PLOT_PRICE + STATION_BUILD_FEE).toBeLessThanOrEqual(400);
});
