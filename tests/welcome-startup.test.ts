import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {GameSnapshot} from '../shared/game';
import type {GameplaySession} from '../src/lib/near-auth';
const calls = vi.hoisted(() => ({request: vi.fn(), saved: vi.fn(), identity: vi.fn(), permission: vi.fn()}));
vi.mock('../src/lib/city-api', () => ({cityRequest: calls.request, getCitySession: calls.saved}));
vi.mock('../src/lib/near-auth', () => ({getNearIdentity: calls.identity, getGameplaySession: calls.permission}));
import {loadWelcomeState, type AppConfig} from '../src/lib/welcome-startup';

const config: AppConfig = {
  network: 'testnet',
  authConfigured: true,
  guestPlay: false,
  chainSyncEnabled: true,
  localMode: false,
  appOrigin: 'http://localhost:3000',
  contractId: 'worldo.testnet',
};
const identity = {accountId: 'player.testnet', publicKey: 'ed25519:fixture', expiresAt: Date.now() + 60000};
const permission: GameplaySession = {
  ...identity,
  network: 'testnet',
  contractId: 'worldo.testnet',
  expiresAt: Date.now() + 60000,
  spendLimit: 100000,
  spent: 45,
  authorizedAt: 1,
  createdAt: 1,
  state: 'active',
};
const overview = {world: {id: 'world'}, player: {accountId: 'overview'}} as GameSnapshot;
const saved = {
  snapshot: {world: {id: 'world'}, player: {accountId: identity.accountId}} as GameSnapshot,
  chain: {status: 'synced'},
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}
function callbacks() {
  return {
    isCurrent: vi.fn(() => true),
    onConfig: vi.fn(),
    onOverview: vi.fn(),
    onIdentity: vi.fn(),
    onSaved: vi.fn(),
    onPermission: vi.fn(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? config : overview));
  calls.identity.mockResolvedValue(identity);
  calls.permission.mockResolvedValue(permission);
  calls.saved.mockResolvedValue(saved);
});

describe('welcome startup reads', () => {
  it('establishes configuration before any other request can create a competing session cookie', async () => {
    const first = deferred<AppConfig>();
    calls.request.mockImplementation((path: string) =>
      path === '/api/game/config' ? first.promise : Promise.resolve(overview),
    );
    const cb = callbacks(),
      work = loadWelcomeState(cb);
    expect(calls.request).toHaveBeenCalledExactlyOnceWith('/api/game/config');
    expect(calls.identity).not.toHaveBeenCalled();
    expect(calls.saved).not.toHaveBeenCalled();
    expect(calls.permission).not.toHaveBeenCalled();
    first.resolve(config);
    await expect(work).resolves.toBe(true);
  });
  it('publishes Play configuration while overview and identity reads are still blocked', async () => {
    const world = deferred<GameSnapshot>(),
      user = deferred<typeof identity>();
    calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? config : world.promise));
    calls.identity.mockReturnValue(user.promise);
    const cb = callbacks(),
      work = loadWelcomeState(cb);
    await vi.waitFor(() => expect(cb.onConfig).toHaveBeenCalledExactlyOnceWith(config));
    expect(cb.onOverview).not.toHaveBeenCalled();
    expect(cb.onIdentity).not.toHaveBeenCalled();
    world.resolve(overview);
    user.resolve(identity);
    await work;
  });
  it('hydrates identity and permission independently of a slow overview', async () => {
    const world = deferred<GameSnapshot>();
    calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? config : world.promise));
    const cb = callbacks(),
      work = loadWelcomeState(cb);
    await vi.waitFor(() => expect(cb.onPermission).toHaveBeenLastCalledWith(true));
    expect(cb.onIdentity).toHaveBeenCalledExactlyOnceWith(identity);
    expect(cb.onSaved).toHaveBeenCalledExactlyOnceWith(saved);
    expect(cb.onOverview).not.toHaveBeenCalled();
    world.resolve(overview);
    await work;
  });
  it('publishes identity before permission and saved-state hydration finish', async () => {
    const grant = deferred<GameplaySession>(),
      game = deferred<typeof saved>();
    calls.permission.mockReturnValue(grant.promise);
    calls.saved.mockReturnValue(game.promise);
    const cb = callbacks(),
      work = loadWelcomeState(cb);
    await vi.waitFor(() => expect(cb.onIdentity).toHaveBeenCalledExactlyOnceWith(identity));
    expect(cb.onPermission).toHaveBeenLastCalledWith(false);
    expect(cb.onSaved).not.toHaveBeenCalled();
    grant.resolve(permission);
    game.resolve(saved);
    await work;
  });
  it('ignores a stale configuration without launching further reads', async () => {
    const first = deferred<AppConfig>();
    calls.request.mockReturnValue(first.promise);
    const cb = callbacks(),
      work = loadWelcomeState(cb);
    cb.isCurrent.mockReturnValue(false);
    first.resolve(config);
    await expect(work).resolves.toBe(false);
    expect(cb.onConfig).not.toHaveBeenCalled();
    expect(calls.identity).not.toHaveBeenCalled();
    expect(calls.request).toHaveBeenCalledTimes(1);
  });
  it('ignores already-running hydration after Play or a newer attempt takes over', async () => {
    const world = deferred<GameSnapshot>(),
      grant = deferred<GameplaySession>(),
      game = deferred<typeof saved>();
    calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? config : world.promise));
    calls.permission.mockReturnValue(grant.promise);
    calls.saved.mockReturnValue(game.promise);
    const cb = callbacks(),
      work = loadWelcomeState(cb);
    await vi.waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
    cb.isCurrent.mockReturnValue(false);
    world.resolve(overview);
    grant.resolve(permission);
    game.resolve(saved);
    await expect(work).resolves.toBe(false);
    expect(cb.onOverview).not.toHaveBeenCalled();
    expect(cb.onSaved).not.toHaveBeenCalled();
    expect(cb.onPermission).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('reports known unavailable authentication as incomplete instead of endless loading', async () => {
    const unavailable = {...config, authConfigured: false};
    calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? unavailable : overview));
    const cb = callbacks();
    await expect(loadWelcomeState(cb)).resolves.toBe(false);
    expect(cb.onConfig).toHaveBeenCalledExactlyOnceWith(unavailable);
    expect(cb.onOverview).toHaveBeenCalledExactlyOnceWith(overview);
    expect(calls.identity).not.toHaveBeenCalled();
    expect(cb.onPermission).toHaveBeenLastCalledWith(false);
  });
  it('does not hide configuration or stop independent reads when saved-game loading fails', async () => {
    const world = deferred<GameSnapshot>(),
      failure = new Error('Saved state unavailable');
    calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? config : world.promise));
    calls.saved.mockRejectedValue(failure);
    const cb = callbacks();
    let settled = false;
    const work = loadWelcomeState(cb);
    const outcome = work.then(
      () => {
        settled = true;
        return null;
      },
      error => {
        settled = true;
        return error;
      },
    );
    await vi.waitFor(() => expect(cb.onPermission).toHaveBeenLastCalledWith(true));
    expect(cb.onConfig).toHaveBeenCalledExactlyOnceWith(config);
    expect(settled).toBe(false);
    world.resolve(overview);
    expect(await outcome).toBe(failure);
    expect(cb.onOverview).toHaveBeenCalledExactlyOnceWith(overview);
  });
  it.each([
    ['account', {accountId: 'other.testnet'}],
    ['key', {publicKey: 'ed25519:other'}],
    ['network', {network: 'mainnet'}],
    ['contract', {contractId: 'other.testnet'}],
    ['revoked', {state: 'revoked'}],
    ['spent', {spent: 100000}],
    ['expired', {expiresAt: 1}],
  ])('does not reuse a mismatched or unusable %s permission', async (_label, change) => {
    calls.permission.mockResolvedValue({...permission, ...change});
    const cb = callbacks();
    await loadWelcomeState(cb);
    expect(cb.onPermission).toHaveBeenLastCalledWith(false);
  });
  it('loads local saved games without identity or permission requests', async () => {
    const local = {...config, authConfigured: false, chainSyncEnabled: false, localMode: true, contractId: null};
    calls.request.mockImplementation(async (path: string) => (path === '/api/game/config' ? local : overview));
    const cb = callbacks();
    await expect(loadWelcomeState(cb)).resolves.toBe(true);
    expect(calls.identity).not.toHaveBeenCalled();
    expect(calls.permission).not.toHaveBeenCalled();
    expect(cb.onIdentity).not.toHaveBeenCalled();
    expect(cb.onSaved).toHaveBeenCalledExactlyOnceWith(saved);
    expect(cb.onPermission).toHaveBeenCalledExactlyOnceWith(true);
  });
});
