import {afterEach, describe, expect, it, vi} from 'vitest';
import {KeyPair} from '@near-js/crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appMode,
  canonicalAppOrigin,
  nearNetworkConfiguration,
  publicRpcUrl,
  type Environment,
} from '../server/near-config';
import {
  createReadinessChecker,
  validProductionDatabase,
  socialSignInConfigured,
  assertMainnetReady,
  assertAccountReady,
  assertTransactionReady,
  getProductionReadiness,
  verifyMainnetDeployment,
  verifyAuthCallback,
  readOnlyReadinessFetch,
  requiresGameplayReadiness,
} from '../server/production-readiness';
import {nearConfiguration} from '../server/near';

const setup = (): Environment => ({
  APP_MODE: 'production',
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://worldo.example',
  NEAR_NETWORK: 'mainnet',
  NEAR_AUTH_MODE: 'social',
  NEAR_AUTH_CLIENT_ID: 'worldo-approved-client',
  NEAR_CONTRACT_ID: 'economy.worldo.near',
  NEAR_RELAYER_ACCOUNT_ID: 'relayer.worldo.near',
  NEAR_RELAYER_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(),
  NEAR_RELAYER_SIGN_DEPOSIT_YOCTO: '1',
  NEAR_RELAYER_DAILY_BUDGET_YOCTO: '1000000000000000000000000',
  NEAR_ORACLE_ACCOUNT_ID: 'oracle.worldo.near',
  NEAR_ORACLE_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(),
  NEAR_REFINERY_ACCOUNT: 'refinery.worldo.near',
  NEAR_REFINERY_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(),
  NEAR_MOTOR_ACCOUNT: 'motor.worldo.near',
  NEAR_MOTOR_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(),
  NEAR_HARBOR_ACCOUNT: 'harbor.worldo.near',
  NEAR_HARBOR_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(),
  DATABASE_URL:
    'postgresql://worldo:example-only-password@ep-worldo-pooler.us-east-2.aws.neon.tech/worldo?sslmode=require',
  ENABLE_MAINNET: 'true',
});
function contractView(method: string, args: Record<string, string>, env: Environment) {
  if (method === 'is_paused') return false;
  if (method === 'configuration')
    return {
      version: 2,
      assetTransferMode: 'game-ledger',
      network: env.NEAR_NETWORK,
      oracle: env.NEAR_ORACLE_ACCOUNT_ID,
      oracleKey: KeyPair.fromString(env.NEAR_ORACLE_PRIVATE_KEY as `ed25519:${string}`)
        .getPublicKey()
        .toString(),
      cities: {refinery: env.NEAR_REFINERY_ACCOUNT, motor: env.NEAR_MOTOR_ACCOUNT, harbor: env.NEAR_HARBOR_ACCOUNT},
    };
  if (method === 'city_key') {
    const key = ['NEAR_REFINERY_ACCOUNT', 'NEAR_MOTOR_ACCOUNT', 'NEAR_HARBOR_ACCOUNT'].find(
      k => env[k] === args.account_id,
    )!;
    return KeyPair.fromString(env[key.replace('_ACCOUNT', '_PRIVATE_KEY')] as `ed25519:${string}`)
      .getPublicKey()
      .toString();
  }
  return {registered: true, balances: {coin: 12000}, nonce: 0};
}
const probes = () => ({
  database: vi.fn().mockResolvedValue(undefined),
  localStorage: vi.fn().mockResolvedValue(undefined),
  auth: vi.fn().mockResolvedValue(undefined),
  chain: vi.fn().mockResolvedValue(undefined),
  gameplay: vi.fn().mockResolvedValue(undefined),
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('production entry and mainnet readiness', () => {
  it('never chooses a disposable wallet by default or exposes it in production', () => {
    expect(appMode({NODE_ENV: 'production'})).toBe('production');
    expect(appMode({NODE_ENV: 'test'})).toBe('development');
    expect(nearNetworkConfiguration({}).network).toBe('testnet');
  });
  it('requires a pooled Neon connection with TLS rather than any nonempty URL', () => {
    expect(validProductionDatabase(setup().DATABASE_URL)).toBe(true);
    for (const value of [
      'postgres://u:p@localhost/db',
      'postgres://u:p@ep-worldo.neon.tech/db?sslmode=require',
      'postgres://u:p@ep-worldo-pooler.neon.tech/db',
      'postgres://u:p@ep-worldo-pooler.neon.tech/db?sslmode=disable',
    ])
      expect(validProductionDatabase(value)).toBe(false);
  });
  it('never exposes private RPC credentials through status metadata', () => {
    expect(publicRpcUrl('https://free.rpc.fastnear.com')).toBe('https://free.rpc.fastnear.com');
    expect(publicRpcUrl('https://rpc.example/private-provider-key')).toBeNull();
    expect(publicRpcUrl('https://rpc.example?apiKey=private-provider-key')).toBeNull();
  });
  it('variable presence alone cannot enable mainnet and missing settings skip external probes', async () => {
    const p = probes(),
      checker = createReadinessChecker(p);
    expect(checker.snapshot(setup()).ready).toBe(false);
    const result = await checker.refresh({
      PUBLIC_URL: 'https://worldo.example',
      APP_MODE: 'production',
      NEAR_NETWORK: 'mainnet',
    });
    expect(result.ready).toBe(false);
    expect(p.database).not.toHaveBeenCalled();
    expect(p.chain).not.toHaveBeenCalled();
    expect(p.auth).not.toHaveBeenCalled();
  });
  it('allows configured social sign-in while cold or failed health checks keep transactions disabled', async () => {
    const env = setup();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(socialSignInConfigured(env)).toBe(true);
    expect(nearConfiguration()).toMatchObject({
      authConfigured: true,
      clientId: env.NEAR_AUTH_CLIENT_ID,
      productionReady: false,
      accountOperationsEnabled: false,
      liveEnabled: false,
    });
    let time = 1000;
    const p = probes(),
      checker = createReadinessChecker(p, () => time);
    p.auth.mockRejectedValue(new Error('Provider unavailable'));
    p.chain.mockRejectedValue(new Error('RPC unavailable'));
    expect(await checker.refresh(env)).toMatchObject({ready: false, accountReady: false});
    expect(socialSignInConfigured(env)).toBe(true);
    time += 60001;
    expect(checker.snapshot(env).checkedAt).toBeNull();
    expect(socialSignInConfigured(env)).toBe(true);
    expect(nearConfiguration()).toMatchObject({authConfigured: true, accountOperationsEnabled: false});
  });
  it('requires valid social, network and origin configuration even before checking providers', () => {
    const env = setup();
    for (const changes of [
      {NEAR_AUTH_CLIENT_ID: ''},
      {NEAR_AUTH_MODE: 'testnet-wallet'},
      {NEAR_AUTH_CLIENT_ID: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl'},
      {NEAR_AUTH_CLIENT_ID: 'dsurLc47fOcWme5PkYeClBvuW0tYrmgW'},
      {NEAR_AUTH_DOMAIN: 'login.testnet.fast-auth.com'},
      {NEAR_AUTH_AUDIENCE: 'auth0.jwt.fast-auth.testnet'},
      {NEAR_AUTH_GUARD_ID: 'jwt#https://login.testnet.fast-auth.com/'},
      {PUBLIC_URL: 'http://worldo.example'},
      {PUBLIC_URL: 'http://localhost:3000'},
      {PUBLIC_URL: ''},
      {APP_ORIGIN: 'https://another.example'},
      {NEAR_NETWORK: 'unsupported'},
      {NEAR_RPC_URL: 'https://test.rpc.fastnear.com'},
    ])
      expect(socialSignInConfigured({...env, ...changes})).toBe(false);
    expect(
      socialSignInConfigured({
        ...env,
        NEAR_NETWORK: 'testnet',
        NEAR_AUTH_CLIENT_ID: '',
        PUBLIC_URL: 'http://localhost:3000',
      }),
    ).toBe(true);
  });
  it('supports social testnet in the player-facing product with explicit single-process durable storage', async () => {
    const env = setup();
    for (const key of Object.keys(env))
      if (key.endsWith('_ACCOUNT') || key.endsWith('_ACCOUNT_ID') || key === 'NEAR_CONTRACT_ID')
        env[key] = env[key]!.replace(/\.near$/, '.testnet');
    Object.assign(env, {
      NEAR_NETWORK: 'testnet',
      NEAR_AUTH_CLIENT_ID: '',
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: '',
      LOCAL_DATA_DIR: '.local/test-world',
      TESTNET_SINGLE_PROCESS: 'true',
      ENABLE_TESTNET: 'true',
      ENABLE_MAINNET: 'false',
    });
    const p = probes(),
      checker = createReadinessChecker(p);
    expect((await checker.refresh(env)).ready).toBe(true);
    expect(p.localStorage).toHaveBeenCalledWith('.local/test-world');
    expect(p.database).not.toHaveBeenCalled();
    expect((await checker.refresh({...env, TESTNET_SINGLE_PROCESS: 'false'})).ready).toBe(false);
    expect((await checker.refresh({...env, NEAR_AUTH_MODE: 'testnet-wallet'})).ready).toBe(false);
    expect(canonicalAppOrigin(env)).toBe('http://localhost:3000');
    expect(() => canonicalAppOrigin({...env, NEAR_NETWORK: 'mainnet'})).toThrow('HTTPS');
  });
  it('tests callback eligibility without cookies, credentials or a social login', async () => {
    const env = {NEAR_NETWORK: 'testnet', NODE_ENV: 'production', PUBLIC_URL: 'http://localhost:3000'};
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', {status: 302, headers: {Location: 'http://localhost:3000/?error=login_required'}}),
      );
    await expect(verifyAuthCallback(env)).resolves.toBeUndefined();
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(request.mock.calls[0][1]).toMatchObject({redirect: 'manual', credentials: 'omit'});
    request.mockResolvedValueOnce(new Response('Callback URL mismatch', {status: 403}));
    await expect(verifyAuthCallback({...env, PUBLIC_URL: 'https://worldo.example'})).rejects.toThrow('callback');
  });
  it('requires all live checks and a separate operator release before accepting money', async () => {
    const p = probes(),
      checker = createReadinessChecker(p),
      env = setup();
    expect((await checker.refresh({...env, ENABLE_MAINNET: 'false'})).ready).toBe(false);
    expect((await checker.refresh(env)).ready).toBe(true);
    const failed = probes();
    failed.database.mockRejectedValue(new Error('secret-connection-string'));
    const result = await createReadinessChecker(failed).refresh(env);
    expect(result.ready).toBe(false);
    expect(result.checks.find(c => c.id === 'storage')?.status).toBe('unverified');
    const publicResult = JSON.stringify(result);
    for (const secret of [
      env.DATABASE_URL!,
      env.NEAR_ORACLE_PRIVATE_KEY!,
      env.NEAR_RELAYER_PRIVATE_KEY!,
      'secret-connection-string',
    ])
      expect(publicResult).not.toContain(secret);
  });
  it.each(['unfunded oracle', 'unavailable merchant'])(
    'preserves owner revocation while gameplay has an %s',
    async problem => {
      const folder = await mkdtemp(path.join(os.tmpdir(), 'worldo-account-readiness-')),
        env = setup();
      for (const key of Object.keys(env))
        if (key.endsWith('_ACCOUNT') || key.endsWith('_ACCOUNT_ID') || key === 'NEAR_CONTRACT_ID')
          env[key] = env[key]!.replace(/\.near$/, '.testnet');
      Object.assign(env, {
        NEAR_NETWORK: 'testnet',
        NEAR_RPC_URL: '',
        NEAR_AUTH_CLIENT_ID: '',
        PUBLIC_URL: 'http://localhost:3000',
        DATABASE_URL: '',
        LOCAL_DATA_DIR: folder,
        TESTNET_SINGLE_PROCESS: 'true',
        ENABLE_TESTNET: 'true',
        ENABLE_MAINNET: 'false',
      });
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input)),
          issuer = 'https://login.testnet.fast-auth.com/';
        if (url.pathname.endsWith('/openid-configuration'))
          return Response.json({issuer, jwks_uri: issuer + '.well-known/jwks.json'});
        if (url.pathname.endsWith('/jwks.json')) return Response.json({keys: [{kty: 'RSA', alg: 'RS256', use: 'sig'}]});
        if (url.pathname === '/authorize')
          return new Response('', {status: 302, headers: {Location: 'http://localhost:3000/?error=login_required'}});
        const body = JSON.parse(String(init?.body));
        expect(['status', 'query']).toContain(body.method);
        if (body.method === 'status') return Response.json({result: {chain_id: 'testnet'}});
        const p = body.params;
        let result: unknown;
        if (p.request_type === 'view_access_key') result = {permission: 'FullAccess'};
        else if (p.request_type === 'view_account')
          result = {
            code_hash: 'deployed-code',
            amount:
              problem === 'unfunded oracle' && p.account_id === env.NEAR_ORACLE_ACCOUNT_ID
                ? '0'
                : '1000000000000000000000000',
            storage_usage: 1000,
          };
        else {
          if (problem === 'unavailable merchant' && p.method_name === 'account')
            return Response.json({error: {message: 'Merchant unavailable'}});
          const value = contractView(p.method_name, JSON.parse(Buffer.from(p.args_base64, 'base64').toString()), env);
          result = {result: [...Buffer.from(JSON.stringify(value))]};
        }
        return Response.json({result});
      });
      try {
        const status = await getProductionReadiness();
        expect(status).toMatchObject({accountReady: true, ready: false});
        expect(nearConfiguration()).toMatchObject({
          accountOperationsEnabled: true,
          liveEnabled: true,
          liveGameplayEnabled: false,
        });
        await expect(assertAccountReady()).resolves.toBeUndefined();
        for (const method of ['authorize_game', 'revoke_game'])
          await expect(assertTransactionReady(method)).resolves.toBeUndefined();
        for (const method of ['apply_batch', 'unknown'])
          await expect(assertTransactionReady(method)).rejects.toThrow('awaiting verified configuration');
        vi.stubEnv('ENABLE_TESTNET', 'false');
        expect((await getProductionReadiness()).accountReady).toBe(false);
        await expect(assertAccountReady()).rejects.toThrow('awaiting verified configuration');
      } finally {
        if (path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep))
          await rm(folder, {recursive: true, force: true});
      }
    },
  );
  it('keeps all account prerequisites mandatory when only gameplay dependencies are missing', async () => {
    const env = setup(),
      p = probes();
    delete env.NEAR_ORACLE_PRIVATE_KEY;
    delete env.NEAR_HARBOR_ACCOUNT;
    expect(await createReadinessChecker(p).refresh(env)).toMatchObject({accountReady: true, ready: false});
    expect(p.gameplay).not.toHaveBeenCalled();
    for (const changes of [
      {NEAR_RELAYER_PRIVATE_KEY: ''},
      {DATABASE_URL: ''},
      {NEAR_AUTH_CLIENT_ID: ''},
      {ENABLE_MAINNET: 'false'},
    ])
      expect((await createReadinessChecker(probes()).refresh({...env, ...changes})).accountReady).toBe(false);
    for (const method of ['authorize_game', 'revoke_game']) expect(requiresGameplayReadiness(method)).toBe(false);
    for (const method of ['apply_batch', 'unknown']) expect(requiresGameplayReadiness(method)).toBe(true);
  });
  it('does not accept testnet/shared credentials as an approved production app', async () => {
    for (const changes of [
      {NEAR_AUTH_CLIENT_ID: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl'},
      {NEAR_AUTH_CLIENT_ID: 'dsurLc47fOcWme5PkYeClBvuW0tYrmgW'},
      {NEAR_AUTH_DOMAIN: 'login.testnet.fast-auth.com'},
      {NEAR_CONTRACT_ID: 'worldo.testnet'},
      {NEAR_AUTH_MODE: 'testnet-wallet'},
    ]) {
      expect((await createReadinessChecker(probes()).refresh({...setup(), ...changes})).ready).toBe(false);
    }
  });
  it('invalidates readiness when configuration changes or the verification expires', async () => {
    let time = 1000;
    const p = probes(),
      checker = createReadinessChecker(p, () => time),
      env = setup();
    await checker.refresh(env);
    expect(checker.snapshot(env).ready).toBe(true);
    expect(checker.snapshot({...env, NEAR_CONTRACT_ID: 'replacement.near'}).ready).toBe(false);
    time += 60001;
    expect(checker.snapshot(env).ready).toBe(false);
    p.chain.mockRejectedValue(new Error('offline'));
    expect((await checker.refresh(env)).ready).toBe(false);
  });
  it('rechecks a failed probe after five seconds instead of holding a temporary outage for a minute', async () => {
    let time = 1000;
    const p = probes(),
      checker = createReadinessChecker(p, () => time),
      env = setup();
    p.auth.mockRejectedValueOnce(new Error('Temporary DNS failure'));
    expect((await checker.refresh(env)).ready).toBe(false);
    time += 4999;
    expect((await checker.refresh(env)).ready).toBe(false);
    expect(p.auth).toHaveBeenCalledTimes(1);
    time += 2;
    expect((await checker.refresh(env)).ready).toBe(true);
    expect(p.auth).toHaveBeenCalledTimes(2);
  });
  it('retries a transient DNS failure once for a read and never retries a forbidden callback', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), {cause: {code: 'ENOTFOUND'}}),
      request = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response('{}'));
    expect((await readOnlyReadinessFetch('https://issuer.example/metadata')).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockReset().mockResolvedValueOnce(new Response('Callback mismatch', {status: 403}));
    expect((await readOnlyReadinessFetch('https://issuer.example/authorize')).status).toBe(403);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('bounds network retries and refuses to use retry logic for a transaction submission', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), {cause: {code: 'ECONNRESET'}}));
    await expect(
      readOnlyReadinessFetch('https://rpc.example', {
        method: 'POST',
        body: JSON.stringify({method: 'status', params: []}),
      }),
    ).rejects.toThrow('fetch failed');
    expect(request).toHaveBeenCalledTimes(2);
    request.mockClear();
    await expect(
      readOnlyReadinessFetch('https://rpc.example', {
        method: 'POST',
        body: JSON.stringify({method: 'send_tx', params: {}}),
      }),
    ).rejects.toThrow('read-only');
    expect(request).not.toHaveBeenCalled();
  });
  it('checks actual chain ID, city accounts and mayor keys without making a transaction', async () => {
    let chainId = 'testnet',
      registered = true;
    const calls: Record<string, any>[] = [];
    const env = setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      expect(['status', 'query']).toContain(body.method);
      if (body.method === 'status') return new Response(JSON.stringify({result: {chain_id: chainId}}));
      const p = body.params;
      let result: unknown;
      if (p.request_type === 'view_access_key') result = {permission: 'FullAccess'};
      else if (p.request_type === 'view_account')
        result = {code_hash: 'deployed-code', amount: '1000000000000000000000000', storage_usage: 1000};
      else {
        if (p.method_name === 'account' && !registered)
          return new Response(JSON.stringify({error: {message: 'Unknown merchant'}}));
        const value = contractView(p.method_name, JSON.parse(Buffer.from(p.args_base64, 'base64').toString()), env);
        result = {result: [...Buffer.from(JSON.stringify(value))]};
      }
      return new Response(JSON.stringify({result}));
    });
    await expect(verifyMainnetDeployment(env)).rejects.toThrow('Wrong chain');
    expect(calls).toHaveLength(1);
    chainId = 'mainnet';
    await expect(verifyMainnetDeployment(env)).resolves.toBeUndefined();
    expect(calls.filter(c => c.params?.method_name === 'city_key')).toHaveLength(3);
    registered = false;
    await expect(verifyMainnetDeployment(env)).rejects.toThrow('Chain verification');
  });
  it('rejects disposable-wallet production configuration and keeps incomplete mainnet funding disabled', async () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('PUBLIC_URL', 'https://worldo.example');
    vi.stubEnv('NEAR_NETWORK', 'testnet');
    vi.stubEnv('NEAR_RPC_URL', '');
    vi.stubEnv('NEAR_AUTH_MODE', 'testnet-wallet');
    expect(nearConfiguration()).toMatchObject({
      productMode: 'production',
      defaultWorld: 'live',
      authConfigured: false,
      liveEnabled: false,
      liveGameplayEnabled: false,
    });
    await expect(assertMainnetReady()).rejects.toThrow('awaiting verified configuration');
    vi.stubEnv('NEAR_NETWORK', 'mainnet');
    vi.stubEnv('NEAR_AUTH_MODE', 'social');
    vi.stubEnv('NEAR_AUTH_CLIENT_ID', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('ENABLE_MAINNET', 'false');
    expect(nearConfiguration()).toMatchObject({authConfigured: false, productionReady: false, liveEnabled: false});
    await expect(assertMainnetReady()).rejects.toThrow('awaiting verified configuration');
  });
});
