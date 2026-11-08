import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createWorld} from '../server/economy/index';

const database = vi.hoisted(() => ({
  row: null as string | null,
  revision: 0,
  selects: 0,
  updates: 0,
  failNextUpdate: false,
  failNextSelect: false,
}));
vi.mock('@neondatabase/serverless', () => ({
  neon:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (text.startsWith('SELECT data')) {
        database.selects++;
        if (database.failNextSelect) {
          database.failNextSelect = false;
          throw new Error('terminated');
        }
        return database.row ? [{data: JSON.parse(database.row)}] : [];
      }
      if (text.startsWith('INSERT')) {
        database.row = String(values[1]);
        return [];
      }
      if (text.startsWith('UPDATE')) {
        database.updates++;
        const [revision, data, , expected] = values as [number, string, string, number];
        if (database.failNextUpdate) {
          database.failNextUpdate = false;
          database.revision += 1;
          return [];
        }
        if (expected !== database.revision) return [];
        database.revision = revision;
        database.row = data;
        return [{scope: 'world'}];
      }
      return [];
    },
}));
import {WorldStore} from '../server/world-store';

const seed = () =>
  createWorld({
    network: 'testnet',
    contractId: 'worldo.testnet',
    cityAccounts: {refinery: 'r.testnet', motor: 'm.testnet', harbor: 'h.testnet'},
    now: 1800000000000,
  });
const move = (data: ReturnType<typeof seed>) => ({
  data: {...data, world: {...data.world, revision: data.world.revision + 1}},
  plan: null,
});

beforeEach(() => {
  Object.assign(database, {
    row: null,
    revision: 0,
    selects: 0,
    updates: 0,
    failNextUpdate: false,
    failNextSelect: false,
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('hosted storage speed', () => {
  async function ready() {
    const store = new WorldStore('.local/fixture-cache', 'postgresql://fixture:fixture@localhost/worldo');
    const world = seed();
    await store.create(world.world.id, world);
    return {store, scope: world.world.id};
  }

  const restart = () => new WorldStore('.local/fixture-cache', 'postgresql://fixture:fixture@localhost/worldo');

  it('reads the saved world once on a cold start, however many callers are waiting', async () => {
    const {scope} = await ready();
    const store = restart();
    database.selects = 0;
    await Promise.all([store.get(scope), store.get(scope), store.getChainStatus(scope)]);
    await store.get(scope);
    expect(database.selects).toBe(1);
  });
  it('does not keep a failed cold read, so the next caller tries again', async () => {
    const {scope} = await ready();
    const store = restart();
    database.failNextSelect = true;
    await expect(store.get(scope)).rejects.toThrow('terminated');
    expect(await store.get(scope)).not.toBeNull();
  });
  it('keeps walking in memory and writes it shortly afterwards', async () => {
    const {store, scope} = await ready();
    await store.applyImmediate(scope, move, 'move-1', false, {soft: true});
    const selects = database.selects;
    for (let step = 2; step <= 20; step++) await store.applyImmediate(scope, move, `move-${step}`, false, {soft: true});
    expect(database.selects).toBe(selects);
    expect(database.updates).toBe(0);
    await vi.advanceTimersByTimeAsync(5500);
    expect(database.updates).toBe(1);
    expect(database.revision).toBe(20);
  });

  it('saves real game actions at once, along with any waiting movement', async () => {
    const {store, scope} = await ready();
    await store.applyImmediate(scope, move, 'move-1', false, {soft: true});
    await store.applyImmediate(scope, move, 'trade', false);
    expect(database.updates).toBe(1);
    expect(database.revision).toBe(2);
  });

  it('reloads the truth if another writer changed the world', async () => {
    const {store, scope} = await ready();
    await store.applyImmediate(scope, move, 'trade-1', false);
    database.failNextUpdate = true;
    const selects = database.selects;
    await store.applyImmediate(scope, move, 'trade-2', false).catch(() => undefined);
    expect(database.selects).toBeGreaterThan(selects);
  });

  it('serves repeated reads from memory', async () => {
    const {store, scope} = await ready();
    await store.applyImmediate(scope, move, 'trade', false);
    const selects = database.selects;
    await store.get(scope);
    await store.get(scope);
    expect(database.selects).toBe(selects);
  });
});
