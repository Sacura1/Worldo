// Plays a full session against the compiled contract with no network and no keys.
// It proves the deployed code accepts everything the economy sends, and that the
// contract's final balances match the game's own numbers exactly.
// Run: npx tsx scripts/verify-contract-wasm.ts path/to/worldo.wasm
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {GameAction, SettlementBatch, SettlementPlan, WorldData} from '../shared/game';
import {applyAction, advanceWorld, createWorld, quoteTrade, registerPlayer} from '../server/economy/index';
import {CITIES, CITY_IDS, SIM_TICK_MS} from '../shared/config/cities';
import {STATION_BUILD_WOOD} from '../shared/config/stations';
import {CITY_TRADE_POINTS, RESOURCE_NODES} from '../shared/city-layout';
import {compactOutbox, estimateWorldBatchLogBytes} from '../shared/batches';

const contractId = 'worldo.testnet';
const oracle = 'oracle.testnet';
const accounts = {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'};
const emptyKey = 'ed25519:11111111111111111111111111111111';
const emptySignature = Buffer.alloc(64).toString('base64');
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;

/** A small stand-in for the NEAR runtime. Signature checks always pass here, because
 * this run is about economic rules. The contract's own signature tests cover those. */
class Runtime {
  storage = new Map<string, Buffer>();
  module: WebAssembly.Module;
  now = 0;
  logs: string[] = [];
  constructor(code: Buffer) {
    this.module = new WebAssembly.Module(new Uint8Array(code));
  }
  call(method: string, args: unknown, predecessor: string) {
    const registers = new Map<number, Buffer>();
    const input = Buffer.from(JSON.stringify(args));
    let output: Buffer | null = null;
    let panic = '';
    let memory: WebAssembly.Memory;
    const bytes = (length: bigint, pointer: bigint) => Buffer.from(memory.buffer, Number(pointer), Number(length));
    const key = (length: bigint, pointer: bigint) => bytes(length, pointer).toString('hex');
    const account = (register: bigint, name: string) => {
      registers.set(Number(register), Buffer.from(name));
    };
    const host: Record<string, (...values: bigint[]) => bigint | void> = {
      input: register => {
        registers.set(Number(register), input);
      },
      read_register: (register, pointer) => {
        const value = registers.get(Number(register));
        if (value) Buffer.from(memory.buffer).set(value, Number(pointer));
      },
      register_len: register =>
        registers.has(Number(register)) ? BigInt(registers.get(Number(register))!.length) : -1n,
      current_account_id: register => account(register, contractId),
      predecessor_account_id: register => account(register, predecessor),
      block_index: () => BigInt(Math.floor(this.now / 1000)),
      block_timestamp: () => BigInt(this.now) * 1_000_000n,
      attached_deposit: pointer => {
        Buffer.from(memory.buffer).fill(0, Number(pointer), Number(pointer) + 16);
      },
      prepaid_gas: () => 300_000_000_000_000n,
      storage_read: (length, pointer, register) => {
        const value = this.storage.get(key(length, pointer));
        if (!value) return 0n;
        registers.set(Number(register), value);
        return 1n;
      },
      storage_write: (keyLength, keyPointer, valueLength, valuePointer, register) => {
        const name = key(keyLength, keyPointer);
        const old = this.storage.get(name);
        if (old) registers.set(Number(register), old);
        this.storage.set(name, Buffer.from(bytes(valueLength, valuePointer)));
        return old ? 1n : 0n;
      },
      storage_remove: (length, pointer, register) => {
        const name = key(length, pointer);
        const old = this.storage.get(name);
        if (!old) return 0n;
        registers.set(Number(register), old);
        this.storage.delete(name);
        return 1n;
      },
      storage_has_key: (length, pointer) => (this.storage.has(key(length, pointer)) ? 1n : 0n),
      log_utf8: (length, pointer) => {
        const text = bytes(length, pointer).toString('utf8');
        panic = text;
        this.logs.push(text);
      },
      value_return: (length, pointer) => {
        output = Buffer.from(bytes(length, pointer));
      },
      ed25519_verify: () => 1n,
      promise_result: () => 0n,
    };
    const imports = Object.fromEntries(
      WebAssembly.Module.imports(this.module).map(item => [
        item.name,
        host[item.name] ??
          (() => {
            throw new Error('Missing host call ' + item.name);
          }),
      ]),
    );
    const instance = new WebAssembly.Instance(this.module, {env: imports});
    memory = instance.exports.memory as WebAssembly.Memory;
    const backup = new Map(this.storage);
    try {
      (instance.exports[method] as () => void)();
    } catch (error) {
      this.storage = backup;
      throw new Error(`${method} was refused: ${panic || (error as Error).message}`);
    }
    return output ? JSON.parse((output as Buffer).toString()) : null;
  }
}

const path = process.argv[2];
if (!path) throw new Error('Pass the path of the compiled contract.');
const code = readFileSync(path);
console.log('contract sha256', createHash('sha256').update(code).digest('hex'));
const vm = new Runtime(code);
let now = 1_800_000_000_000;
vm.now = now;
const seedBalances = (id: (typeof CITY_IDS)[number]) =>
  Object.fromEntries(
    Object.entries({coin: CITIES[id].initialTreasury, ...CITIES[id].initialStock}).filter(([, amount]) => amount > 0),
  );
vm.call(
  'new',
  {
    owner: contractId,
    oracle,
    oracle_key: emptyKey,
    network: 'testnet',
    starter_pool: 100000,
    cities: CITY_IDS.map(id => ({account_id: accounts[id], balances: seedBalances(id), public_key: emptyKey})),
  },
  contractId,
);

let data: WorldData = createWorld({network: 'testnet', contractId, cityAccounts: accounts, now});
const queue: SettlementPlan[] = [];
const grants: Record<string, number> = {};
let sequence = 0;
let settled = 0;
let operation = 0;
const add = (plan: SettlementPlan | null, owner?: string) => {
  if (!plan) return;
  if (owner) plan.metadata.authorizationAt = grants[owner];
  queue.push(plan);
};
function settle() {
  let pending = compactOutbox(queue);
  queue.length = 0;
  while (pending.length) {
    const plans: SettlementPlan[] = [];
    for (const plan of pending.slice(0, 20)) {
      const candidate: SettlementBatch = {
        id: 'batch:999999:' + 'f'.repeat(32),
        sequence: sequence + 1,
        previousSequence: sequence,
        plans: [...plans, plan],
        createdAt: now,
      };
      if (estimateWorldBatchLogBytes(candidate) > 12000) break;
      plans.push(plan);
    }
    pending = pending.slice(plans.length);
    sequence++;
    const batch: SettlementBatch = {
      id: `batch:${sequence}:${String(sequence).padStart(32, '0')}`,
      sequence,
      previousSequence: sequence - 1,
      plans,
      createdAt: now,
    };
    vm.now = now;
    vm.call(
      'apply_batch',
      {
        batch: JSON.stringify(canonical(batch)),
        mayor_approvals: Object.values(accounts).map(account => ({account_id: account, signature: emptySignature})),
      },
      oracle,
    );
    settled += plans.length;
  }
}
function join(account: string) {
  vm.now = now;
  const authorization = JSON.stringify({
    accountId: account,
    contractId,
    network: 'testnet',
    expiresAt: now + 25 * 86400000,
    spendLimit: 100000,
    createdAt: now,
  });
  grants[account] = vm.call('authorize_game', {authorization, signature: emptySignature}, account).authorized_at;
  const result = registerPlayer(data, account, now, `register:${account}`);
  data = result.data;
  add(result.plan, account);
}
const act = (account: string, action: GameAction) => {
  const result = applyAction(data, account, action, now, `action-${String(++operation).padStart(8, '0')}`);
  data = result.data;
  add(result.plan, account);
};
const ticks = (count: number) => {
  for (let tick = 0; tick < count; tick++) {
    now += SIM_TICK_MS;
    const result = advanceWorld(data, now, `tick:${String(++operation).padStart(8, '0')}`);
    data = result.data;
    add(result.plan);
    if (tick % 12 === 11) settle();
  }
};
const gather = (account: string, resource: 'crude_oil' | 'wood' | 'rubber', units: number) => {
  const node = RESOURCE_NODES.find(candidate => candidate.resource === resource)!;
  data.players[account].position = {x: node.position.x + 1.5, z: node.position.z};
  // Starter tools slow down with wear. Stop when the cart is full.
  for (let unit = 0; unit < units; unit++) {
    if (Object.values(data.players[account].inventory).reduce((total, amount) => total + amount, 0) >= 20) break;
    act(account, {type: 'gather_start', nodeId: node.id});
    now += data.players[account].gathering!.durationMs + 1;
    act(account, {type: 'gather_finish'});
  }
};
const atCity = (account: string, cityId: (typeof CITY_IDS)[number]) => {
  data.players[account].position = {...CITY_TRADE_POINTS[cityId]};
};

const alice = 'alice.testnet';
const bob = 'bob.testnet';
join(alice);
settle();
gather(alice, 'crude_oil', 20);
atCity(alice, 'refinery');
act(alice, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 18});
act(alice, {type: 'donate', cityId: 'refinery', resource: 'crude_oil', quantity: 2});
ticks(24);
gather(alice, 'crude_oil', 20);
atCity(alice, 'refinery');
act(alice, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 20});
for (let round = 0; round < 4; round++) {
  ticks(12);
  gather(alice, 'crude_oil', 20);
  atCity(alice, 'refinery');
  act(alice, {type: 'sell', cityId: 'refinery', resource: 'crude_oil', quantity: 20});
}
const stationId = 'station:harbor:1';
data.players[alice].position = {...data.world.stations[stationId].position};
act(alice, {type: 'station_buy', stationId, name: 'Proof Fuel'});
gather(alice, 'wood', 20);
data.players[alice].position = {...data.world.stations[stationId].position};
act(alice, {type: 'station_build', stationId, quantity: 20});
gather(alice, 'wood', STATION_BUILD_WOOD - 20);
data.players[alice].position = {...data.world.stations[stationId].position};
act(alice, {type: 'station_build', stationId, quantity: STATION_BUILD_WOOD - 20});
atCity(alice, 'refinery');
act(alice, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: 12});
data.players[alice].position = {...data.world.stations[stationId].position};
act(alice, {type: 'station_stock', stationId, quantity: 12});
act(alice, {type: 'station_price', stationId, price: 22});
settle();
join(bob);
gather(bob, 'wood', 15);
atCity(bob, 'harbor');
act(bob, {type: 'sell', cityId: 'harbor', resource: 'wood', quantity: 15});
for (let hour = 0; hour < 6; hour++) {
  ticks(300);
  gather(alice, 'crude_oil', 20);
  atCity(alice, 'refinery');
  act(alice, {
    type: 'sell',
    cityId: 'refinery',
    resource: 'crude_oil',
    quantity: data.players[alice].inventory.crude_oil,
  });
  const litres = Math.min(15, Math.floor(data.players[alice].coins / 60));
  if (litres < 1 || !quoteTrade(data, 'refinery', 'petrol', 'buy', litres, undefined, alice).available) continue;
  act(alice, {type: 'buy', cityId: 'refinery', resource: 'petrol', quantity: litres});
  data.players[alice].position = {...data.world.stations[stationId].position};
  act(alice, {type: 'station_stock', stationId, quantity: litres});
}
ticks(120);
settle();

const problems: string[] = [];
const compare = (label: string, game: number, chain: number) => {
  if (game !== chain) problems.push(`${label}: game ${game}, contract ${chain}`);
};
const holding = (account: string) => vm.call('account', {account_id: account}, oracle)?.balances ?? {};
for (const id of CITY_IDS) {
  const city = data.world.cities[id];
  const onChain = holding(city.accountId);
  compare(`${id} coins`, city.treasury, onChain.coin ?? 0);
  for (const resource of ['crude_oil', 'petrol', 'rubber', 'wood'] as const)
    compare(`${id} ${resource}`, city.stock[resource], onChain[resource] ?? 0);
}
compare('pool coins', data.world.starterPool, holding(contractId).coin ?? 0);
for (const [account, player] of Object.entries(data.players)) {
  const onChain = holding(account);
  compare(`${account} coins`, player.coins, onChain.coin ?? 0);
  const tanks = Object.values(data.world.stations)
    .filter(station => station.ownerId === account)
    .reduce((total, station) => total + station.tank, 0);
  compare(`${account} petrol`, player.inventory.petrol + tanks, onChain.petrol ?? 0);
}
const station = data.world.stations[stationId];
const tank = vm.call('station_tank', {station_id: stationId}, oracle);
compare('station tank', station.tank, tank?.petrol ?? -1);
const totalCoins = vm.call('mt_supply', {token_id: 'coin'}, oracle);
const events = vm.logs.filter(line => line.includes('mayor_decisions')).length;
console.log(
  JSON.stringify({
    batches: sequence,
    plansSettled: settled,
    players: Object.keys(data.players).length,
    stationSold: station.totalLitresSold,
    stationRevenue: station.totalRevenue,
    worldEvents: data.world.eventCount,
    imports: CITY_IDS.map(id => data.world.cities[id].importedLitres),
    mayorDecisionLogs: events,
    coinSupply: totalCoins,
  }),
);
if (problems.length) {
  console.log('MISMATCH\n' + problems.join('\n'));
  process.exit(1);
}
console.log('PASS: the contract accepted every action and matches the game exactly.');
