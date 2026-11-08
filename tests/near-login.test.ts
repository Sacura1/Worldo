import {beforeAll, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTVerifyGetKey} from 'jose';
import bs58 from 'bs58';
import {NearLogin} from '../server/near-login';
import {nearAuthConfiguration} from '../server/near-config';
import {LoginDependencyError} from '../server/login-dependency';
import {readLoginPublicKey} from '../server/login-public-key';
import {verifyNearSigningToken} from '../server/near-signing-token';

let signingKey: CryptoKey, otherKey: CryptoKey, keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  keys = createLocalJWKSet({keys: [{...(await exportJWK(pair.publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig'}]});
});
const config = nearAuthConfiguration({
  NEAR_NETWORK: 'testnet',
  NEAR_AUTH_CLIENT_ID: 'registered-app',
  NEAR_AUTH_DOMAIN: 'identity.example',
  PUBLIC_URL: 'http://localhost:3000',
});
const sign = (claims: JWTPayload, key = signingKey) =>
  new SignJWT(claims).setProtectedHeader({alg: 'RS256', kid: 'fixture'}).sign(key);
function fixture() {
  let now = 1770000000000,
    currentConfig = config,
    enabled = true;
  const derive = vi.fn(async (subject: string) => ({accountId: 'derived:' + subject})),
    save = vi.fn();
  const request = vi.fn<typeof fetch>();
  const resolveKey = vi.fn<JWTVerifyGetKey>((header, token) => keys(header, token)),
    diagnostic = vi.fn(),
    delay = vi.fn(async (_ms: number) => {});
  const login = new NearLogin({
    config: () => currentConfig,
    enabled: () => enabled,
    now: () => now,
    deriveIdentity: derive,
    saveIdentity: save,
    request,
    keys: () => resolveKey,
    diagnostic,
    delay,
  });
  const start = (session = 'browser-one') => {
    const attempt = login.start(session),
      parameters = new URL(attempt.authorizationUrl).searchParams;
    const claims: JWTPayload = {
      iss: config.issuer,
      aud: config.clientId!,
      sub: 'google-oauth2|verified-player',
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 300,
      nonce: parameters.get('nonce')!,
    };
    request.mockImplementation(async () => Response.json({id_token: await sign(claims)}));
    return {...attempt, parameters, claims, input: {state: parameters.get('state')!, code: 'one-use-provider-code'}};
  };
  return {
    login,
    start,
    request,
    derive,
    save,
    resolveKey,
    diagnostic,
    delay,
    advance: (ms: number) => {
      now += ms;
    },
    changeConfig: () => {
      currentConfig = {...config, clientId: 'different-app'};
    },
    disable: () => {
      enabled = false;
    },
  };
}

describe('asking NEAR Auth about this site before sending a player there', () => {
  const refused = () => new Response('<p>Callback URL mismatch.</p>', {status: 403});
  const allowed = () => new Response(null, {status: 302, headers: {location: '/u/login/identifier'}});

  it('asks about this site without following the redirect', async () => {
    const f = fixture();
    f.request.mockImplementation(async () => allowed());
    await expect(f.login.originAccepted()).resolves.toBe(true);
    const [url, init] = f.request.mock.calls[0];
    expect(new URL(String(url)).searchParams.get('redirect_uri')).toBe(config.appOrigin);
    expect(init?.redirect).toBe('manual');
  });

  it('recognises the refusal NEAR Auth gives an address it has not allowed', async () => {
    const f = fixture();
    f.request.mockImplementation(async () => refused());
    await expect(f.login.originAccepted()).resolves.toBe(false);
  });

  it('keeps sign-in open for any other answer or an outage', async () => {
    const f = fixture();
    f.request.mockImplementationOnce(async () => new Response('Forbidden', {status: 403}));
    await expect(f.login.originAccepted()).resolves.toBe(true);
    f.request.mockImplementationOnce(async () => new Response('down', {status: 503}));
    await expect(f.login.originAccepted()).resolves.toBe(true);
    f.request.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(f.login.originAccepted()).resolves.toBe(true);
    expect(f.request).toHaveBeenCalledTimes(3);
  });

  it('remembers a refusal briefly, so an approval takes effect within a minute', async () => {
    const f = fixture();
    f.request.mockImplementation(async () => refused());
    await expect(f.login.originAccepted()).resolves.toBe(false);
    await expect(f.login.originAccepted()).resolves.toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.advance(60_001);
    f.request.mockImplementation(async () => allowed());
    await expect(f.login.originAccepted()).resolves.toBe(true);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it('asks nothing when NEAR sign-in is not configured', async () => {
    const f = fixture();
    f.disable();
    await expect(f.login.originAccepted()).resolves.toBe(true);
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe('NEAR social login with ordinary OIDC and PKCE', () => {
  it('requests only openid at the registered root and exchanges the code once with matching PKCE', async () => {
    const f = fixture(),
      a = f.start();
    expect(new URL(a.authorizationUrl).origin).toBe('https://identity.example');
    expect(Object.fromEntries(a.parameters)).toMatchObject({
      client_id: config.clientId,
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: config.appOrigin,
      scope: 'openid',
      code_challenge_method: 'S256',
    });
    for (const forbidden of ['audience', 'transaction', 'delegateAction', 'nep413', 'code_verifier'])
      expect(a.parameters.has(forbidden)).toBe(false);
    expect(a.parameters.get('state')).not.toBe(a.attemptId);
    expect(a.parameters.get('nonce')).toHaveLength(43);
    expect(await f.login.complete('browser-one', a.input)).toEqual({ok: true});
    const [url, options] = f.request.mock.calls[0],
      body = options!.body as URLSearchParams;
    expect(String(url)).toBe('https://identity.example/oauth/token');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    });
    expect(body.get('code')).toBe(a.input.code);
    expect(body.get('redirect_uri')).toBe(config.appOrigin);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe(config.clientId);
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
      a.parameters.get('code_challenge'),
    );
    expect(body.has('audience')).toBe(false);
    expect(body.has('scope')).toBe(false);
    expect(f.derive).toHaveBeenCalledWith('google-oauth2|verified-player', config);
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.save).toHaveBeenCalledWith('browser-one', {accountId: 'derived:google-oauth2|verified-player'});
    expect(f.login.status('browser-one', a.attemptId)).toEqual({status: 'complete'});
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Sign-in expired');
    expect(f.request).toHaveBeenCalledOnce();
  });
  it('binds state and status to the originating cookie without burning another browser’s attempt', async () => {
    const f = fixture(),
      a = f.start();
    expect(() => f.login.status('another-browser', a.attemptId)).toThrow('Sign-in expired');
    await expect(f.login.complete('another-browser', a.input)).rejects.toThrow('Sign-in expired');
    expect(f.request).not.toHaveBeenCalled();
    expect(f.login.status('browser-one', a.attemptId)).toEqual({status: 'pending'});
    await expect(f.login.complete('browser-one', a.input)).resolves.toEqual({ok: true});
  });
  it('replaces a previous attempt and does not reuse its nonce or state', async () => {
    const f = fixture(),
      old = f.start(),
      a = f.start();
    expect(old.parameters.get('nonce')).not.toBe(a.parameters.get('nonce'));
    expect(old.parameters.get('state')).not.toBe(a.parameters.get('state'));
    expect(f.login.status('browser-one', old.attemptId)).toEqual({status: 'failed', error: 'Sign-in was cancelled.'});
    await expect(f.login.complete('browser-one', old.input)).rejects.toThrow('Sign-in expired');
    expect(f.request).not.toHaveBeenCalled();
    await f.login.complete('browser-one', a.input);
    expect(f.save).toHaveBeenCalledOnce();
  });
  it('consumes state before the token exchange so concurrent callbacks cannot exchange or save twice', async () => {
    const f = fixture(),
      a = f.start();
    let finish!: (response: Response) => void;
    f.request.mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        }),
    );
    const first = f.login.complete('browser-one', a.input);
    expect(f.login.status('browser-one', a.attemptId)).toEqual({status: 'verifying'});
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Sign-in expired');
    finish(Response.json({id_token: await sign(a.claims)}));
    await first;
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.save).toHaveBeenCalledOnce();
  });
  it.each([
    'nonce',
    'audience',
    'issuer',
    'azp',
    'multiple-audiences-without-azp',
    'expired',
    'future-iat',
    'stale-iat',
    'missing-exp',
    'missing-iat',
    'missing-sub',
    'empty-sub',
    'invalid-signature',
  ])('rejects %s even when the provider returns an ID token', async invalid => {
    const f = fixture(),
      a = f.start();
    let key = signingKey;
    switch (invalid) {
      case 'nonce':
        a.claims.nonce = 'another-attempt';
        break;
      case 'audience':
        a.claims.aud = 'another-app';
        break;
      case 'issuer':
        a.claims.iss = 'https://untrusted.example/';
        break;
      case 'azp':
        a.claims.azp = 'another-app';
        break;
      case 'multiple-audiences-without-azp':
        a.claims.aud = [config.clientId!, 'another-app'];
        break;
      case 'expired':
        a.claims.exp = a.claims.iat! - 6;
        break;
      case 'future-iat':
        a.claims.iat! += 30;
        break;
      case 'stale-iat':
        a.claims.iat! -= 306;
        break;
      case 'missing-exp':
        delete a.claims.exp;
        break;
      case 'missing-iat':
        delete a.claims.iat;
        break;
      case 'missing-sub':
        delete a.claims.sub;
        break;
      case 'empty-sub':
        a.claims.sub = '';
        break;
      case 'invalid-signature':
        key = otherKey;
        break;
    }
    f.request.mockResolvedValue(Response.json({id_token: await sign(a.claims, key)}));
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Could not verify your NEAR sign-in');
    expect(f.derive).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.login.status('browser-one', a.attemptId).status).toBe('failed');
    expect(f.resolveKey).toHaveBeenCalledOnce();
    expect(f.delay).not.toHaveBeenCalled();
  });
  it.each([-2, 2])('accepts a small %s-second clock difference with the signed provider token', async skew => {
    const f = fixture(),
      a = f.start();
    a.claims.iat! += skew;
    a.claims.exp! += skew;
    await expect(f.login.complete('browser-one', a.input)).resolves.toEqual({ok: true});
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.diagnostic).not.toHaveBeenCalled();
  });
  it('records only a safe claim code for a clock difference outside tolerance', async () => {
    const f = fixture(),
      a = f.start();
    a.claims.iat! += 30;
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Could not verify');
    expect(f.diagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'token_verification',
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'iat',
      readAttempt: 1,
      retrying: false,
      durationMs: 0,
    });
    expect(JSON.stringify(f.diagnostic.mock.calls)).not.toContain(a.claims.sub);
    expect(f.request).toHaveBeenCalledOnce();
  });
  it('retries a transient JWKS read once without exchanging the authorization code again', async () => {
    const f = fixture(),
      a = f.start();
    f.resolveKey.mockRejectedValueOnce(Object.assign(new Error('private issuer response'), {code: 'ERR_JWKS_TIMEOUT'}));
    await expect(f.login.complete('browser-one', a.input)).resolves.toEqual({ok: true});
    expect(f.resolveKey).toHaveBeenCalledTimes(2);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.delay).toHaveBeenCalledExactlyOnceWith(250);
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.diagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'token_verification',
      code: 'TIMEOUT',
      readAttempt: 1,
      retrying: true,
      durationMs: 0,
    });
  });
  it('reports a repeated JWKS transport failure as unavailable, not an invalid identity', async () => {
    const f = fixture(),
      a = f.start();
    f.resolveKey.mockRejectedValue(Object.assign(new TypeError('private fetch URL'), {cause: {code: 'ENOTFOUND'}}));
    await expect(f.login.complete('browser-one', a.input)).rejects.toMatchObject({
      status: 503,
      message: 'NEAR sign-in is temporarily unavailable. Please try again.',
    });
    expect(f.resolveKey).toHaveBeenCalledTimes(2);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.derive).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.diagnostic).toHaveBeenLastCalledWith({
      stage: 'token_verification',
      code: 'DNS_UNAVAILABLE',
      readAttempt: 2,
      retrying: false,
      durationMs: 0,
    });
  });
  it('retries only the transient identity lookup after verifying the token', async () => {
    const f = fixture(),
      a = f.start();
    f.derive.mockRejectedValueOnce(new LoginDependencyError('RPC_HTTP', true, 503));
    await expect(f.login.complete('browser-one', a.input)).resolves.toEqual({ok: true});
    expect(f.derive).toHaveBeenCalledTimes(2);
    expect(f.resolveKey).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.diagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'identity_lookup',
      code: 'RPC_HTTP',
      httpStatus: 503,
      readAttempt: 1,
      retrying: true,
      durationMs: 0,
    });
  });
  it('stops after two failed identity reads and does not save an identity', async () => {
    const f = fixture(),
      a = f.start();
    f.derive.mockRejectedValue(new LoginDependencyError('TIMEOUT', true));
    await expect(f.login.complete('browser-one', a.input)).rejects.toMatchObject({status: 503});
    expect(f.derive).toHaveBeenCalledTimes(2);
    expect(f.delay).toHaveBeenCalledOnce();
    expect(f.save).not.toHaveBeenCalled();
  });
  it.each(['DERIVED_KEY_INVALID', 'RPC_RESPONSE_INVALID', 'RPC_ERROR'] as const)(
    'does not retry %s identity responses',
    async code => {
      const f = fixture(),
        a = f.start();
      f.derive.mockRejectedValue(new LoginDependencyError(code, false));
      await expect(f.login.complete('browser-one', a.input)).rejects.toMatchObject({status: 503});
      expect(f.derive).toHaveBeenCalledOnce();
      expect(f.delay).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
      expect(f.diagnostic).toHaveBeenCalledExactlyOnceWith({
        stage: 'identity_lookup',
        code,
        readAttempt: 1,
        retrying: false,
        durationMs: 0,
      });
    },
  );
  it.each(['token_verification', 'identity_lookup'] as const)(
    'does not retry %s after cancellation during the delay',
    async stage => {
      const f = fixture(),
        a = f.start();
      if (stage === 'token_verification') f.resolveKey.mockRejectedValueOnce(new LoginDependencyError('TIMEOUT', true));
      else f.derive.mockRejectedValueOnce(new LoginDependencyError('TIMEOUT', true));
      f.delay.mockImplementation(async () => {
        f.login.cancelSession('browser-one');
      });
      await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Sign-in expired');
      expect(f.resolveKey).toHaveBeenCalledOnce();
      expect(f.derive).toHaveBeenCalledTimes(stage === 'identity_lookup' ? 1 : 0);
      expect(f.save).not.toHaveBeenCalled();
      expect(f.request).toHaveBeenCalledOnce();
    },
  );
  it('does not expose unknown dependency messages or fabricated diagnostic codes', async () => {
    const f = fixture(),
      a = f.start();
    f.derive.mockRejectedValue(
      Object.assign(new Error('private-token-and-subject'), {code: 'private-credential', claim: 'private-subject'}),
    );
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('temporarily unavailable');
    expect(f.diagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'identity_lookup',
      code: 'UNCLASSIFIED',
      readAttempt: 1,
      retrying: false,
      durationMs: 0,
    });
    expect(JSON.stringify(f.diagnostic.mock.calls)).not.toContain('private');
  });
  it('does not retry a failed code exchange and records only its HTTP status', async () => {
    const f = fixture(),
      a = f.start();
    f.request.mockResolvedValue(new Response('private-provider-body', {status: 503}));
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('temporarily unavailable');
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.delay).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.diagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'token_exchange',
      code: 'UNCLASSIFIED',
      httpStatus: 503,
      readAttempt: 1,
      retrying: false,
      durationMs: 0,
    });
  });
  it('accepts an explicit matching authorized party with multiple audiences', async () => {
    const f = fixture(),
      a = f.start();
    a.claims.aud = [config.clientId!, 'another-api'];
    a.claims.azp = config.clientId!;
    await expect(f.login.complete('browser-one', a.input)).resolves.toEqual({ok: true});
  });
  it('expires uncompleted attempts without calling the provider', async () => {
    const f = fixture(),
      a = f.start();
    f.advance(300000);
    expect(() => f.login.status('browser-one', a.attemptId)).toThrow('Sign-in expired');
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Sign-in expired');
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'new-login', 'expiry', 'configuration', 'disabled'])(
    'does not publish an identity when %s happens during the MPC key read',
    async event => {
      const f = fixture(),
        a = f.start();
      let release!: (identity: {accountId: string}) => void, started!: () => void;
      const deriving = new Promise<void>(resolve => {
        started = resolve;
      });
      f.derive.mockImplementation(() => {
        started();
        return new Promise(resolve => {
          release = resolve;
        });
      });
      const completed = f.login.complete('browser-one', a.input);
      await deriving;
      if (event === 'cancel') f.login.cancelSession('browser-one');
      if (event === 'new-login') f.start();
      if (event === 'expiry') f.advance(300000);
      if (event === 'configuration') f.changeConfig();
      if (event === 'disabled') f.disable();
      release({accountId: 'derived:old-identity'});
      await expect(completed).rejects.toThrow('Sign-in expired');
      expect(f.save).not.toHaveBeenCalled();
    },
  );
  it('does not expose provider errors, HTML, credentials, or tokens in failures', async () => {
    const f = fixture(),
      a = f.start();
    await expect(
      f.login.complete('browser-one', {state: a.input.state, error: '<script>private-provider-error</script>'}),
    ).rejects.toThrow('NEAR sign-in could not be completed. Please try again.');
    expect(f.request).not.toHaveBeenCalled();
    expect(JSON.stringify(f.login.status('browser-one', a.attemptId))).not.toContain('script');
    const second = f.start();
    f.request.mockResolvedValue(new Response('sensitive response', {status: 500}));
    await expect(f.login.complete('browser-one', second.input)).rejects.toThrow('temporarily unavailable');
    expect(f.login.status('browser-one', second.attemptId)).toEqual({
      status: 'failed',
      error: 'NEAR sign-in is temporarily unavailable. Please try again.',
    });
    expect(f.save).not.toHaveBeenCalled();
  });
  it('treats denied consent as cancelled and consumes it', async () => {
    const f = fixture(),
      a = f.start();
    await expect(f.login.complete('browser-one', {state: a.input.state, error: 'access_denied'})).rejects.toThrow(
      'Sign-in was cancelled.',
    );
    await expect(f.login.complete('browser-one', a.input)).rejects.toThrow('Sign-in expired');
    expect(f.request).not.toHaveBeenCalled();
  });
  it('rejects malformed callback input and blocks old signing-login fallbacks', async () => {
    const f = fixture(),
      a = f.start();
    await expect(
      f.login.complete('browser-one', {state: a.input.state, code: a.input.code, error: 'access_denied'}),
    ).rejects.toThrow('Could not verify');
    expect(f.request).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
});

describe('login-only MPC public key reads', () => {
  const options = {
    rpcUrl: 'https://rpc.example/',
    mpcContract: 'mpc.testnet',
    authContract: 'auth.testnet',
    path: 'jwt#issuer#private-subject',
  };
  const publicKey = 'ed25519:' + bs58.encode(Buffer.alloc(32, 7));
  const keyResponse = (value: unknown) => Response.json({result: {result: [...Buffer.from(JSON.stringify(value))]}});
  it('reads the exact configured key using a query, validates it and derives the implicit account', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(keyResponse(publicKey));
    await expect(readLoginPublicKey(options, request)).resolves.toEqual({publicKey, accountId: '07'.repeat(32)});
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.method).toBe('query');
    expect(body.params).toMatchObject({
      request_type: 'call_function',
      finality: 'final',
      account_id: 'mpc.testnet',
      method_name: 'derived_public_key',
    });
    expect(JSON.parse(Buffer.from(body.params.args_base64, 'base64').toString())).toEqual({
      path: options.path,
      predecessor: 'auth.testnet',
      domain_id: 1,
    });
  });
  it.each([429, 503])('classifies HTTP%s as retryable without returning response content', async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-body', {status}));
    await expect(readLoginPublicKey(options, request)).rejects.toMatchObject({
      code: 'RPC_HTTP',
      retryable: true,
      httpStatus: status,
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([null, 'secp256k1:invalid', 'ed25519:invalid', 'ed25519:' + bs58.encode(Buffer.alloc(31))])(
    'rejects malformed or unsupported derived keys without retry eligibility',
    async value => {
      await expect(
        readLoginPublicKey(options, vi.fn<typeof fetch>().mockResolvedValue(keyResponse(value))),
      ).rejects.toMatchObject({code: 'DERIVED_KEY_INVALID', retryable: false});
    },
  );
  it('classifies transient transport failures without including the private RPC URL', async () => {
    const failure = Object.assign(new TypeError('https://rpc.example/private-token'), {
      cause: {code: 'UND_ERR_CONNECT_TIMEOUT'},
    });
    await expect(readLoginPublicKey(options, vi.fn<typeof fetch>().mockRejectedValue(failure))).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
      message: 'The sign-in dependency is unavailable.',
    });
  });
  it('rejects malformed RPC bytes and explicit RPC errors without retry eligibility', async () => {
    for (const response of [
      Response.json({result: {result: [300]}}),
      Response.json({error: {message: 'private-rpc-error'}}),
    ]) {
      await expect(
        readLoginPublicKey(options, vi.fn<typeof fetch>().mockResolvedValue(response)),
      ).rejects.toMatchObject({retryable: false});
    }
  });
});

describe('signing-token clock tolerance', () => {
  const now = 1770000000000;
  const claims = (): JWTPayload => ({
    iss: config.issuer,
    aud: config.audience,
    sub: 'google-oauth2|verified-player',
    azp: config.clientId!,
    iat: now / 1000,
    exp: now / 1000 + 300,
    fatxn: [1, 2, 3],
  });
  it.each([-2, 2])('accepts a signed approval token with %s-second provider skew', async skew => {
    const payload = claims();
    payload.iat! += skew;
    payload.exp! += skew;
    const result = await verifyNearSigningToken(await sign(payload), config, keys, new Date(now));
    expect(result.payload).toEqual(payload);
  });
  it.each(['future-iat', 'stale-iat', 'expired', 'issuer', 'audience', 'signature'])(
    'continues rejecting invalid %s on approval tokens',
    async invalid => {
      const payload = claims();
      let key = signingKey;
      if (invalid === 'future-iat') payload.iat! += 30;
      if (invalid === 'stale-iat') payload.iat! -= 306;
      if (invalid === 'expired') payload.exp = now / 1000 - 6;
      if (invalid === 'issuer') payload.iss = 'https://wrong.example/';
      if (invalid === 'audience') payload.aud = config.clientId!;
      if (invalid === 'signature') key = otherKey;
      await expect(verifyNearSigningToken(await sign(payload, key), config, keys, new Date(now))).rejects.toThrow();
    },
  );
});
