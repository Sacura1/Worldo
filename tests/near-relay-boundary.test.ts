import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import express from 'express';
import {createServer} from 'node:http';
import {KeyPair} from '@near-js/crypto';
import bs58 from 'bs58';

const calls = vi.hoisted(() => ({
  verify: vi.fn(),
  sign: vi.fn(),
  submitDelegate: vi.fn(),
  submitUser: vi.fn(),
  ready: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  local: true,
  identity: {accountId: 'player.testnet', publicKey: '', authSubject: 'google|player', expiresAt: 0},
}));
vi.mock('jose', () => ({createRemoteJWKSet: vi.fn(() => () => {}), jwtVerify: calls.verify}));
vi.mock('../server/near-login', () => ({
  NearLogin: class {
    constructor(private options: {saveIdentity: (session: string, identity: unknown) => void}) {}
    async complete(session: string) {
      this.options.saveIdentity(session, {...calls.identity});
      return {ok: true};
    }
  },
}));
vi.mock('../server/production-readiness', () => ({
  productionReadinessSnapshot: () => ({ready: true, accountReady: true, checks: []}),
  getProductionReadiness: vi.fn(),
  socialSignInConfigured: () => true,
  assertAccountReady: vi.fn(),
  assertTransactionReady: calls.ready,
}));
vi.mock('../server/near-config', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/near-config')>()),
  assertNearRpcNetwork: vi.fn(),
}));
vi.mock('../server/gameplay-sessions', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/gameplay-sessions')>()),
  loadGameplaySession: calls.load,
  saveGameAuthority: calls.save,
}));
vi.mock('../server/relayer', () => ({
  localRelayerConfigured: () => calls.local,
  relayAuthorizedSignature: calls.sign,
  submitSponsoredDelegate: calls.submitDelegate,
  submitUserTransaction: calls.submitUser,
  provisionNearWallet: vi.fn(),
}));
import {createNearRouter} from '../server/near';
import {GameError} from '../server/errors';

const nativeFetch = globalThis.fetch,
  player = KeyPair.fromRandom('ed25519');
let grant: unknown, finalHeight: number, rpcUnavailable: boolean, externalUnavailable: boolean;
let outbound: MockInstance<typeof fetch>;
beforeEach(() => {
  vi.clearAllMocks();
  calls.local = true;
  calls.load.mockResolvedValue(null);
  calls.save.mockResolvedValue(undefined);
  calls.ready.mockResolvedValue(undefined);
  calls.sign.mockResolvedValue('fixture-signature');
  calls.identity = {
    accountId: 'player.testnet',
    publicKey: player.getPublicKey().toString(),
    authSubject: 'google|player',
    expiresAt: Date.now() + 60000,
  };
  for (const [key, value] of Object.entries({
    NEAR_NETWORK: 'testnet',
    APP_MODE: 'development',
    NEAR_AUTH_MODE: 'social',
    NEAR_AUTH_CLIENT_ID: 'test-client',
    NEAR_CONTRACT_ID: 'worldo.testnet',
    ENABLE_TESTNET: 'true',
    NEAR_ORACLE_PRIVATE_KEY: player.toString(),
    NEAR_AUTH_RELAYER_URL: 'https://relayer.example',
  }))
    vi.stubEnv(key, value);
  grant = {expires_at: Date.now() + 60000, spend_limit: 100000, spent: 0, revoked: false, authorized_at: Date.now()};
  finalHeight = 401;
  rpcUnavailable = false;
  externalUnavailable = false;
  calls.submitDelegate.mockRejectedValue(new Error('Network response lost'));
  outbound = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://relayer.example/')) {
      if (externalUnavailable) throw new TypeError('Network response lost');
      return Response.json({
        result: {transaction: {hash: 'fixture-hash'}, status: {SuccessValue: ''}, receipts_outcome: []},
      });
    }
    const body = JSON.parse(init!.body as string);
    if (body.method === 'query' && body.params.request_type === 'view_access_key')
      return Response.json({
        result: {nonce: 10, block_height: 100, block_hash: bs58.encode(new Uint8Array(32)), permission: 'FullAccess'},
      });
    if (body.method === 'query' && body.params.method_name === 'game_authority') {
      if (rpcUnavailable) throw new TypeError('RPC response lost');
      return Response.json({result: {result: [...Buffer.from(JSON.stringify(grant))], block_height: finalHeight}});
    }
    throw new Error('Unexpected fixture provider request.');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function fixture() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionId = req.get('x-session') || 'fixture-browser';
    next();
  });
  app.use('/api/near', createNearRouter());
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res
      .status(error instanceof GameError ? error.status : 500)
      .json({error: error instanceof Error ? error.message : 'Fixture failure'}),
  );
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as {port: number}).port;
  const sid = crypto.randomUUID(),
    post = (route: string, body: unknown) =>
      nativeFetch(url + '/api/near' + route, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-session': sid},
        body: JSON.stringify(body),
      });
  await post('/login/complete', {});
  const preparedResponse = await post('/gameplay-session/prepare', {});
  expect(preparedResponse.status).toBe(200);
  const prepared = await preparedResponse.json();
  calls.verify.mockResolvedValue({
    payload: {sub: calls.identity.authSubject, azp: 'test-client', fatxn: prepared.payload},
  });
  return {
    post,
    prepared,
    relay: () => post('/relay', {id: prepared.id, token: 'fixture-token'}),
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

describe('owner transaction submission boundary', () => {
  it.each(['binding', 'readiness', 'mpc'])(
    'reports submitted:false after definite %s failure before the game transaction starts',
    async failure => {
      const f = await fixture();
      try {
        if (failure === 'binding')
          calls.verify.mockResolvedValue({
            payload: {sub: 'another-player', azp: 'test-client', fatxn: f.prepared.payload},
          });
        if (failure === 'readiness') calls.ready.mockRejectedValue(new Error('Account readiness unavailable'));
        if (failure === 'mpc') calls.sign.mockRejectedValue(new Error('MPC signature unavailable'));
        const response = await f.relay();
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({submitted: false});
        expect(calls.submitDelegate).not.toHaveBeenCalled();
        expect(calls.submitUser).not.toHaveBeenCalled();
      } finally {
        await f.close();
      }
    },
  );
  it('retains uncertainty when local submission was attempted but its response is lost', async () => {
    const f = await fixture();
    try {
      const response = await f.relay();
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({submitted: true});
      expect(calls.submitDelegate).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  });
  it('never calls a consumed id definitely unsubmitted after its earlier submission', async () => {
    const f = await fixture();
    try {
      await f.relay();
      const repeated = await f.relay();
      expect(repeated.status).toBe(403);
      expect(await repeated.json()).not.toHaveProperty('submitted');
      expect(calls.submitDelegate).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  });
  it('marks the external sign-and-submit request before awaiting any response', async () => {
    const f = await fixture();
    try {
      calls.local = false;
      externalUnavailable = true;
      const response = await f.relay();
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({submitted: true});
      expect(calls.submitDelegate).not.toHaveBeenCalled();
      expect(calls.sign).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it('keeps the finalized failure receipt so an explicit retry can use terminal evidence', async () => {
    const f = await fixture();
    try {
      calls.submitDelegate.mockResolvedValue({
        transaction: {hash: 'failed-fixture-hash'},
        status: {Failure: {}},
        receipts_outcome: [],
      });
      const response = await f.relay();
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        hash: 'failed-fixture-hash',
        explorerUrl: 'https://testnet.nearblocks.io/txns/failed-fixture-hash',
      });
    } finally {
      await f.close();
    }
  });
});

describe('FINAL grant recovery evidence', () => {
  it('returns the prepared delegate expiry and height of the same FINAL grant query', async () => {
    const f = await fixture();
    try {
      expect(f.prepared.maxBlockHeight).toBe('400');
      const response = await f.post('/gameplay-session/confirm', {});
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        session: {accountId: 'player.testnet', state: 'active', spendLimit: 100000},
        finalizedBlockHeight: '401',
      });
      const queries = outbound.mock.calls
        .map(([, init]) => JSON.parse(init!.body as string))
        .filter(body => body.params.method_name === 'game_authority');
      expect(queries).toHaveLength(1);
      expect(queries[0].params).toMatchObject({
        request_type: 'call_function',
        finality: 'final',
        account_id: 'worldo.testnet',
      });
      expect(outbound.mock.calls.map(([, init]) => JSON.parse(init!.body as string).method)).not.toContain('block');
    } finally {
      await f.close();
    }
  });
  it('includes FINAL height only for an authoritative no-grant result', async () => {
    const f = await fixture();
    try {
      grant = null;
      const response = await f.post('/gameplay-session/confirm', {});
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: 'Authorize Worldo game-token settlement first.',
        finalizedBlockHeight: '401',
      });
      expect(calls.save).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it.each(['network', 'storage', 'invalid-height', 'malformed-grant'])(
    'omits expiry evidence after %s failure',
    async failure => {
      const f = await fixture();
      try {
        if (failure === 'network') rpcUnavailable = true;
        if (failure === 'storage') calls.load.mockRejectedValue(new Error('Storage unavailable'));
        if (failure === 'invalid-height') finalHeight = Number.NaN;
        if (failure === 'malformed-grant') grant = false;
        const response = await f.post('/gameplay-session/confirm', {});
        expect(response.status).toBe(422);
        expect(await response.json()).not.toHaveProperty('finalizedBlockHeight');
      } finally {
        await f.close();
      }
    },
  );
});
