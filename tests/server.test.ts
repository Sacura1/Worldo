import {afterEach, describe, expect, it, vi} from 'vitest';
import {createServer, type Server} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index';
import {WorldStore} from '../server/world-store';
import {CityController, type CityChainGateway} from '../server/city-controller';
import {GameError} from '../server/errors';
import type {SettlementBatch} from '../shared/game';
import {CITY_START_POSITION} from '../shared/city-layout';
import * as readiness from '../server/production-readiness';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function fixture(sync = false) {
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.stubEnv('NEAR_CONTRACT_ID', 'city.worldo.testnet');
  vi.stubEnv('CHAIN_SYNC_ENABLED', String(sync));
  vi.stubEnv('ENABLE_TESTNET', 'true');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('APP_MODE', 'development');
  const batches: SettlementBatch[] = [],
    accounts = {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'};
  const gateway: CityChainGateway = {
    accounts: () => accounts,
    authorize: vi.fn(async accountId => ({
      accountId,
      publicKey: 'fixture-authority',
      contractId: 'city.worldo.testnet',
      network: 'testnet',
      expiresAt: Date.now() + 86400000,
      spendLimit: 100000,
      state: 'active' as const,
      createdAt: 1,
      authorizedAt: 1,
      spent: 0,
    })),
    reconcileBatch: vi.fn(async () => ({receipt: null, safeToAbort: false})),
    settleBatch: vi.fn(async batch => {
      batches.push(batch);
      return {
        transactionHash: 'fixture-receipt-' + batch.sequence,
        explorerUrl: 'https://testnet.nearblocks.io/txns/fixture-receipt-' + batch.sequence,
        operationId: batch.id,
        confirmedAt: Date.now(),
      };
    }),
  };
  const folder = await mkdtemp(path.join(os.tmpdir(), 'worldo-ownership-api-')),
    store = new WorldStore(folder, ''),
    controller = new CityController(store, gateway);
  if (sync)
    vi.spyOn(controller, 'account').mockImplementation(req => {
      if (req.get('x-fixture-player') !== 'alice') throw new GameError('Sign in to enter Worldo.', 401);
      return 'alice.testnet';
    });
  const server = createServer(await createApp(store, {frontend: false, worker: false, controller}));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as {port: number}).port;
  const response = await fetch(base + '/api/game/overview'),
    cookie = response.headers.get('set-cookie')!.split(';')[0];
  const post = (endpoint: string, body: unknown, extra: Record<string, string> = {}) =>
    fetch(base + endpoint, {
      method: 'POST',
      headers: {cookie, 'content-type': 'application/json', ...(sync ? {'x-fixture-player': 'alice'} : {}), ...extra},
      body: JSON.stringify(body),
    });
  const get = (endpoint: string) =>
    fetch(base + endpoint, {headers: {cookie, ...(sync ? {'x-fixture-player': 'alice'} : {})}});
  return {
    controller,
    store,
    base,
    post,
    get,
    cookie,
    response,
    gateway,
    batches,
    close: async () => {
      controller.stop();
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep))
        throw Error('Unexpected temporary path');
      await rm(folder, {recursive: true, force: true});
    },
  };
}
describe('immediate gameplay and delayed batch settlement', () => {
  it('keeps the settlement worker alive when recording a failure is also unavailable', async () => {
    const f = await fixture(true);
    try {
      vi.useFakeTimers();
      vi.spyOn(f.controller, 'tick').mockResolvedValue(undefined);
      const settle = vi.spyOn(f.controller, 'settle').mockRejectedValue(new Error('Storage unavailable'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      f.controller.start();
      await vi.advanceTimersByTimeAsync(60000);
      expect(warn).toHaveBeenCalledWith('Chain settlement is waiting for storage:', 'Storage unavailable');
      await vi.advanceTimersByTimeAsync(60000);
      expect(settle).toHaveBeenCalledTimes(2);
    } finally {
      f.controller.stop();
      vi.useRealTimers();
      await f.close();
    }
  }, 20000);
  it('freezes only the revoked grant epoch without discarding already accepted actions', async () => {
    const f = await fixture(true);
    try {
      await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()});
      const accepted = (await f.controller.data()).players['alice.testnet'].nonce;
      expect(await f.controller.freezeGameAuthority('alice.testnet', 1)).toEqual({lastAcceptedNonce: accepted});
      expect(
        (await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()})).status,
      ).toBe(401);
      expect((await f.controller.chainStatus()).queuedActions).toBe(1);
      await f.controller.settle();
      expect(f.batches[0].plans[0].nonce).toBe(accepted);
      expect((await f.controller.chainStatus()).queuedActions).toBe(0);
      vi.mocked(f.gateway.authorize).mockImplementation(async accountId => ({
        accountId,
        publicKey: 'fixture-authority',
        contractId: 'city.worldo.testnet',
        network: 'testnet',
        expiresAt: Date.now() + 86400000,
        spendLimit: 100000,
        state: 'active',
        createdAt: 2,
        authorizedAt: 2,
        spent: 0,
      }));
      expect(
        (await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()})).status,
      ).toBe(200);
      expect((await f.controller.data()).players['alice.testnet'].coins).toBe(100);
    } finally {
      await f.close();
    }
  }, 20000);
  it('commits a starter grant once before any chain calls, then attaches a real batch receipt', async () => {
    const f = await fixture(true);
    try {
      const operationId = crypto.randomUUID();
      const body = {action: {type: 'register'}, operationId};
      const a = await f.post('/api/game/action', body);
      expect(a.status).toBe(200);
      const result = await a.json();
      expect(result).toMatchObject({snapshot: {player: {coins: 100}}, queued: true});
      expect(result.snapshot.receipt).toBeUndefined();
      expect(f.gateway.settleBatch).not.toHaveBeenCalled();
      expect(f.gateway.reconcileBatch).not.toHaveBeenCalled();
      const b = await f.post('/api/game/action', body);
      expect((await b.json()).snapshot.player.coins).toBe(100);
      expect((await f.controller.chainStatus()).queuedActions).toBe(1);
      await f.controller.settle();
      expect(f.batches).toHaveLength(1);
      expect((await f.controller.chainStatus()).lastSettledBatch?.transactionHash).toBe('fixture-receipt-1');
      expect((await f.controller.session('alice.testnet')).snapshot?.player.coins).toBe(100);
      expect((await f.controller.chainStatus()).queuedActions).toBe(0);
    } finally {
      await f.close();
    }
  }, 20000);
  it('continues accepting game actions while a batch confirmation is unavailable', async () => {
    const f = await fixture(true);
    try {
      await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()});
      vi.mocked(f.gateway.settleBatch).mockRejectedValue(new Error('fixture RPC outage'));
      await f.controller.settle();
      const status = await f.controller.chainStatus();
      expect(status.status).toBe('delayed');
      expect(status.queuedActions).toBe(1);
      const move = await f.post('/api/game/action', {
        action: {type: 'move', position: {...CITY_START_POSITION}, heading: 0.1},
        operationId: crypto.randomUUID(),
      });
      expect(move.status).toBe(200);
      expect((await move.json()).snapshot.player.heading).toBe(0.1);
      expect((await f.controller.chainStatus()).pendingBatch?.id).toBe(status.pendingBatch?.id);
    } finally {
      await f.close();
    }
  }, 20000);
  it('checks authorization locally before reserving a coin debit and rejects missing identity', async () => {
    const f = await fixture(true);
    try {
      expect((await fetch(f.base + '/api/game/session')).status).toBe(401);
      vi.mocked(f.gateway.authorize).mockRejectedValue(new Error('expired'));
      const result = await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()});
      expect(result.status).toBe(401);
      expect((await f.controller.store.get(f.controller.scope))?.players).toEqual({});
      expect(f.gateway.reconcileBatch).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 20000);
});
describe('complete local play without chain credentials', () => {
  it('keeps cold and expired production login available without waiting for provider health checks', async () => {
    const f = await fixture(true);
    try {
      vi.stubEnv('APP_MODE', 'production');
      vi.stubEnv('PUBLIC_URL', 'http://localhost:3000');
      vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
      vi.stubEnv('NEAR_AUTH_MODE', 'social');
      const refresh = vi
        .spyOn(readiness, 'getProductionReadiness')
        .mockRejectedValue(new Error('Provider unavailable'));
      const time = Date.now(),
        now = vi.spyOn(Date, 'now');
      for (const elapsed of [0, 60001]) {
        now.mockReturnValue(time + elapsed);
        expect(await (await f.get('/api/game/config')).json()).toMatchObject({
          authConfigured: true,
          chainSyncEnabled: true,
        });
        expect(await (await f.get('/api/near/status')).json()).toMatchObject({
          authConfigured: true,
          productionReady: false,
          accountOperationsEnabled: false,
        });
        expect(await (await f.get('/api/near/identity')).json()).toEqual({identity: null});
        const login = await f.post('/api/near/login/start', {});
        expect(login.status).toBe(200);
        const started = await login.json();
        expect(started).toMatchObject({
          authorizationUrl: expect.any(String),
          attemptId: expect.any(String),
          expiresAt: expect.any(Number),
        });
        const parameters = new URL(started.authorizationUrl).searchParams;
        expect(parameters.get('redirect_uri')).toBe('http://localhost:3000');
        expect(parameters.get('scope')).toBe('openid');
        expect(parameters.has('audience')).toBe(false);
        expect(await (await f.get('/api/near/login/status?attemptId=' + started.attemptId)).json()).toEqual({
          status: 'pending',
        });
      }
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 20000);
  it('refreshes readiness only when account diagnostics explicitly request it', async () => {
    const f = await fixture(true);
    try {
      vi.stubEnv('APP_MODE', 'production');
      const result = readiness.productionReadinessSnapshot(),
        refresh = vi.spyOn(readiness, 'getProductionReadiness').mockResolvedValue(result);
      expect(await (await f.get('/api/near/readiness')).json()).toEqual(result);
      expect((await f.get('/api/near/status?readiness=1')).status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect((await f.get('/api/near/status')).status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  }, 20000);
  it('keeps missing social sign-in configuration blocked without probing providers', async () => {
    const f = await fixture(true);
    try {
      vi.stubEnv('APP_MODE', 'production');
      vi.stubEnv('NEAR_AUTH_MODE', 'testnet-wallet');
      const refresh = vi
        .spyOn(readiness, 'getProductionReadiness')
        .mockRejectedValue(new Error('Provider unavailable'));
      expect(await (await f.get('/api/game/config')).json()).toMatchObject({authConfigured: false});
      expect(await (await f.get('/api/near/status')).json()).toMatchObject({authConfigured: false, clientId: null});
      const login = await f.post('/api/near/login/start', {});
      expect(login.status).toBe(503);
      expect(await login.json()).toEqual({error: 'NEAR Auth credentials are not configured.'});
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 20000);
  it('keeps OIDC callback/status/cancellation tied to the original cookie and removes the signing-login endpoints', async () => {
    const f = await fixture(true);
    try {
      vi.stubEnv('NEAR_AUTH_MODE', 'social');
      vi.stubEnv('PUBLIC_URL', 'http://localhost:3000');
      vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
      const started = await (await f.post('/api/near/login/start', {})).json(),
        state = new URL(started.authorizationUrl).searchParams.get('state');
      expect((await fetch(f.base + '/api/near/login/status?attemptId=' + started.attemptId)).status).toBe(401);
      expect(
        (
          await fetch(f.base + '/api/near/login/complete', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({state, error: 'access_denied'}),
          })
        ).status,
      ).toBe(401);
      expect(await (await f.get('/api/near/login/status?attemptId=' + started.attemptId)).json()).toEqual({
        status: 'pending',
      });
      const denial = await f.post('/api/near/login/complete', {state, error: 'access_denied'});
      expect(denial.status).toBe(401);
      expect(await denial.json()).toEqual({error: 'Sign-in was cancelled.'});
      expect(await (await f.get('/api/near/login/status?attemptId=' + started.attemptId)).json()).toEqual({
        status: 'failed',
        error: 'Sign-in was cancelled.',
      });
      expect(await (await f.get('/api/near/identity')).json()).toEqual({identity: null});
      const second = await (await f.post('/api/near/login/start', {})).json();
      expect((await f.post('/api/near/login/cancel', {attemptId: second.attemptId})).status).toBe(200);
      expect(await (await f.get('/api/near/login/status?attemptId=' + second.attemptId)).json()).toEqual({
        status: 'failed',
        error: 'Sign-in was cancelled.',
      });
      const third = await (await f.post('/api/near/login/start', {})).json();
      expect((await f.post('/api/near/logout', {})).status).toBe(200);
      expect((await (await f.get('/api/near/login/status?attemptId=' + third.attemptId)).json()).status).toBe('failed');
      for (const route of ['/api/near/challenge', '/api/near/verify'])
        expect((await f.post(route, {})).status).toBe(404);
    } finally {
      await f.close();
    }
  }, 20000);
  it('retains verified account readiness before every account transaction route', async () => {
    const f = await fixture(true);
    try {
      vi.stubEnv('APP_MODE', 'production');
      const guard = vi.spyOn(readiness, 'assertAccountReady').mockRejectedValue(new Error('Readiness unavailable'));
      for (const endpoint of [
        '/prepare-wallet',
        '/relay',
        '/gameplay-session/prepare',
        '/gameplay-session/confirm',
        '/gameplay-session/revoke-prepare',
      ]) {
        const response = await f.post('/api/near' + endpoint, {});
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: 'Account transactions are unavailable while Worldo completes its NEAR setup.',
        });
      }
      expect(guard).toHaveBeenCalledTimes(5);
    } finally {
      await f.close();
    }
  }, 20000);
  it('keeps production guest config independent of unavailable authentication providers', async () => {
    const f = await fixture();
    try {
      vi.stubEnv('APP_MODE', 'production');
      const refresh = vi
        .spyOn(readiness, 'getProductionReadiness')
        .mockRejectedValue(new Error('Provider unavailable'));
      expect(await (await f.get('/api/game/config')).json()).toMatchObject({localMode: true, chainSyncEnabled: false});
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 20000);
  it('permits the social sign-in popup relationship while retaining framing and cross-site write protections', async () => {
    const f = await fixture();
    try {
      expect(f.response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
      expect(f.response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(f.response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(f.response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(
        (
          await f.post(
            '/api/game/action',
            {action: {type: 'register'}, operationId: crypto.randomUUID()},
            {origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site'},
          )
        ).status,
      ).toBe(403);
    } finally {
      await f.close();
    }
  }, 20000);
  it('skips no-op simulation writes and coalesces a due tick', async () => {
    const f = await fixture();
    try {
      const current = await f.controller.data(),
        write = vi.spyOn(f.store, 'applyImmediate');
      await Promise.all([f.controller.tick(), f.controller.tick()]);
      expect(write).not.toHaveBeenCalled();
      vi.spyOn(Date, 'now').mockReturnValue(current.world.updatedAt + 5100);
      await Promise.all([f.controller.tick(), f.controller.tick()]);
      expect(write).toHaveBeenCalledTimes(1);
      await f.controller.tick();
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      await f.close();
    }
  }, 20000);
  it('allows isolated station pricing while rejecting all other preview mutations', async () => {
    const f = await fixture();
    try {
      await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()});
      const before = await f.store.get(f.controller.scope);
      const preview = await (await f.get('/api/preview')).json();
      const station = Object.values(preview.snapshot.world.stations).find(
        (s: any) => s.ownerId === preview.snapshot.player.accountId,
      ) as {id: string};
      expect(station).toBeDefined();
      const priced = await f.post('/api/preview/action', {type: 'station_price', stationId: station.id, price: 12});
      expect(priced.status).toBe(200);
      expect((await priced.json()).snapshot.world.stations[station.id].price).toBe(12);
      expect(
        (await f.post('/api/preview/action', {type: 'station_stock', stationId: station.id, quantity: 500})).status,
      ).toBe(400);
      expect(
        (await f.post('/api/preview/action', {type: 'station_price', stationId: 'station:harbor:2', price: 12})).status,
      ).toBe(403);
      expect(
        (await f.post('/api/preview/action', {type: 'station_price', stationId: station.id, price: 0})).status,
      ).toBe(400);
      const live = await (await f.post('/api/preview/advance', {seconds: 1, supply: true, speed: 'live'})).json();
      expect(live.elapsedMs).toBeLessThan(15000);
      expect(await f.store.get(f.controller.scope)).toEqual(before);
      expect(f.gateway.authorize).not.toHaveBeenCalled();
      expect(f.gateway.settleBatch).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 20000);
  it('uses opaque cookies and separate local accounts with no invented chain receipt', async () => {
    const f = await fixture();
    try {
      expect(f.response.headers.get('set-cookie')).toContain('HttpOnly');
      expect(f.response.headers.get('set-cookie')).toContain('SameSite=Strict');
      expect(await f.response.json()).toMatchObject({player: {coins: 0, equipment: []}});
      expect(await (await f.get('/api/game/config')).json()).toMatchObject({
        localMode: true,
        chainSyncEnabled: false,
        authConfigured: false,
      });
      const operationId = crypto.randomUUID();
      const body = {action: {type: 'register'}, operationId};
      const first = await (await f.post('/api/game/action', body)).json();
      expect(first.snapshot.player.coins).toBe(100);
      expect(first.snapshot.player.equipment).toHaveLength(4);
      expect(first.snapshot.receipt).toBeUndefined();
      const second = await (await f.post('/api/game/action', body)).json();
      expect(second.snapshot.player.accountId).toBe(first.snapshot.player.accountId);
      expect(second.snapshot.player.coins).toBe(100);
      expect((await f.controller.chainStatus()).queuedActions).toBe(0);
      await f.controller.settle();
      expect(f.gateway.authorize).not.toHaveBeenCalled();
      expect(f.gateway.settleBatch).not.toHaveBeenCalled();
      expect(f.gateway.reconcileBatch).not.toHaveBeenCalled();
      const status = await (await f.get('/chain/status')).json();
      expect(status).toMatchObject({
        enabled: false,
        status: 'disabled',
        healthy: null,
        lastSettledBatch: null,
        contractId: null,
      });
    } finally {
      await f.close();
    }
  }, 20000);
  it('rejects cross-site writes, balance injection, oversized prices and old private wallet routes', async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.post(
            '/api/game/action',
            {action: {type: 'register'}, operationId: crypto.randomUUID()},
            {origin: 'https://attacker.example'},
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await f.post('/api/game/action', {
            action: {type: 'register', coins: 999999},
            operationId: crypto.randomUUID(),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.post('/api/game/action', {
            action: {type: 'station_price', stationId: 'station:refinery:1', price: 999},
            operationId: crypto.randomUUID(),
          })
        ).status,
      ).toBe(400);
      for (const endpoint of ['/api/session', '/api/action', '/api/reset', '/api/live/session'])
        expect((await f.get(endpoint)).status).toBe(404);
      expect((await f.post('/api/game/settle', {})).status).toBe(404);
    } finally {
      await f.close();
    }
  }, 20000);
  it('isolates accelerated station simulation from local balances and all chain calls', async () => {
    const f = await fixture();
    try {
      await f.post('/api/game/action', {action: {type: 'register'}, operationId: crypto.randomUUID()});
      const before = await f.store.get(f.controller.scope),
        preview = await (await f.get('/api/preview')).json();
      expect(preview.snapshot.world.preview).toBe(true);
      const stepped = await (await f.post('/api/preview/advance', {seconds: 1, supply: true})).json();
      expect(stepped.elapsedMs).toBeGreaterThan(0);
      expect(await f.store.get(f.controller.scope)).toEqual(before);
      expect(f.gateway.settleBatch).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 20000);
});
