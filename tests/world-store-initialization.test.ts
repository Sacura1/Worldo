import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createWorld, registerPlayer} from '../server/economy/index';
import type {WorldData} from '../shared/game';

const storage = vi.hoisted(() => ({sql: vi.fn(), mkdir: vi.fn(), readFile: vi.fn()}));
vi.mock('@neondatabase/serverless', () => ({neon: () => storage.sql}));
vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  mkdir: storage.mkdir,
  readFile: storage.readFile,
}));
import {WorldStore} from '../server/world-store';

const databaseUrl = 'postgresql://fixture:fixture@localhost/worldo';
const queryCount = (prefix: string) =>
  storage.sql.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join('').startsWith(prefix)).length;
beforeEach(() => {
  storage.sql.mockReset().mockResolvedValue([]);
  storage.mkdir.mockReset().mockResolvedValue(undefined);
  storage.readFile.mockReset().mockRejectedValue(Object.assign(new Error('No saved world'), {code: 'ENOENT'}));
});

describe('lazy world storage initialization', () => {
  it('does not start database or filesystem initialization from the constructor', async () => {
    expect(new WorldStore('.local/fixture-world-store', databaseUrl).persistent).toBe(true);
    expect(new WorldStore('.local/fixture-world-store', '').persistent).toBe(false);
    await Promise.resolve();
    expect(storage.sql).not.toHaveBeenCalled();
    expect(storage.mkdir).not.toHaveBeenCalled();
    expect(storage.readFile).not.toHaveBeenCalled();
  });
  it('shares one pending database initialization across concurrent readers and retains successful setup', async () => {
    let finish!: () => void;
    storage.sql.mockImplementationOnce(
      () =>
        new Promise<unknown[]>(resolve => {
          finish = () => resolve([]);
        }),
    );
    const store = new WorldStore('.local/fixture-world-store', databaseUrl);
    const first = store.get('world'),
      second = store.ping(),
      third = store.getChainStatus('world');
    expect(storage.sql).toHaveBeenCalledTimes(1);
    expect(queryCount('CREATE TABLE')).toBe(1);
    finish();
    expect(await first).toBeNull();
    await second;
    expect(await third).toMatchObject({queued: 0, pendingBatch: null});
    await store.get('world');
    expect(queryCount('CREATE TABLE')).toBe(1);
    expect(storage.sql).toHaveBeenCalledTimes(4);
  });
  it('reports one failed initialization to all waiting callers and retries only on a later request', async () => {
    let fail!: (error: Error) => void;
    storage.sql.mockImplementationOnce(
      () =>
        new Promise<unknown[]>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const store = new WorldStore('.local/fixture-world-store', databaseUrl),
      error = Object.assign(new Error('Database DNS unavailable'), {code: 'ENOTFOUND'});
    const waiting = Promise.allSettled([store.get('world'), store.ping()]);
    expect(storage.sql).toHaveBeenCalledTimes(1);
    fail(error);
    expect(await waiting).toEqual([
      {status: 'rejected', reason: error},
      {status: 'rejected', reason: error},
    ]);
    expect(storage.sql).toHaveBeenCalledTimes(1);
    await expect(store.get('world')).resolves.toBeNull();
    expect(queryCount('CREATE TABLE')).toBe(2);
    expect(queryCount('SELECT data')).toBe(1);
  });
  it('recovers from failed local directory setup before attempting to read a world', async () => {
    storage.mkdir.mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
    const store = new WorldStore('.local/fixture-world-store', '');
    await expect(store.get('world')).rejects.toThrow('Storage temporarily unavailable');
    expect(storage.mkdir).toHaveBeenCalledTimes(1);
    expect(storage.readFile).not.toHaveBeenCalled();
    await expect(store.get('world')).resolves.toBeNull();
    await store.ping();
    expect(storage.mkdir).toHaveBeenCalledTimes(2);
    expect(storage.readFile).toHaveBeenCalledTimes(1);
    expect(storage.sql).not.toHaveBeenCalled();
  });
  it('does not retry an uncertain economic commit or repeat successful initialization after a write failure', async () => {
    const now = 1800000000000,
      seed = createWorld({
        network: 'testnet',
        contractId: 'fixture.testnet',
        cityAccounts: {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'},
        now,
      });
    storage.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.startsWith('SELECT data')) return [{data: {revision: 0, data: seed, pending: null, receipts: []}}];
      if (query.startsWith('UPDATE')) throw new Error('Commit outcome unavailable');
      return [];
    });
    const store = new WorldStore('.local/fixture-world-store', databaseUrl),
      build = vi.fn((data: WorldData) => registerPlayer(data, 'player.testnet', now, 'join'));
    await expect(store.applyImmediate(seed.world.id, build, 'join')).rejects.toThrow('Commit outcome unavailable');
    expect(build).toHaveBeenCalledTimes(1);
    expect(queryCount('UPDATE')).toBe(1);
    expect((await store.get(seed.world.id))?.players).toEqual({});
    expect(queryCount('CREATE TABLE')).toBe(1);
    expect(queryCount('UPDATE')).toBe(1);
  });
});
