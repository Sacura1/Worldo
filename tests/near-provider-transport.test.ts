import {createHash, webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NearAuthProvider, type NearAuthOptions} from '../src/lib/near-provider';

// These tests exercise the installed Auth0 SDK, not a mocked Auth0Client. Only
// browser surfaces and the token endpoint are fixtures; no network is used.
// Protocol evidence: Peersyst/fast-auth packages/auth0/src/actions/authorize-app.action.js
// b9c1fbc8861947893dfb53baa2d2c4d351e08f7d accepts transaction/delegateAction;
// ddab262122491fe3315d28195e719fb2151f1f37 adds nep413. The older action emits
// "Signing audience requested without transaction payload" for nep413.
const options: NearAuthOptions = {
  clientId: 'transport-test-client',
  domain: 'provider.example',
  audience: 'signing-api',
  guardId: 'jwt#https://provider.example/',
  appOrigin: 'https://worldo.example',
};
const player = 'google-oauth2|player';
let network: ReturnType<typeof vi.fn>, leaving: ReturnType<typeof vi.fn>;
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (claims: unknown) => `${segment({alg: 'RS256', typ: 'JWT'})}.${segment(claims)}.signature`;
function tokenResponse(url: URL, payload: number[], expiresIn = 30) {
  const now = Math.floor(Date.now() / 1000);
  return Response.json({
    access_token: jwt({sub: player, fatxn: payload}),
    id_token: jwt({
      iss: `https://${options.domain}/`,
      aud: options.clientId,
      sub: player,
      nonce: url.searchParams.get('nonce'),
      iat: now,
      exp: now + 3600,
    }),
    expires_in: expiresIn,
    token_type: 'Bearer',
    scope: url.searchParams.get('scope'),
  });
}
/** Runs the part before the page leaves and reports where the tab was sent. */
async function leaveFor(payload: number[]) {
  const saved = vi.fn();
  await new NearAuthProvider(options).beginApproval(payload, saved);
  return {url: new URL(leaving.mock.lastCall![0] as string), saved};
}
const denial = (url: URL) =>
  `?state=${encodeURIComponent(url.searchParams.get('state')!)}&error=access_denied&error_description=rejected`;
const success = (url: URL, code = 'fixture-authorization-code') =>
  `?code=${code}&state=${encodeURIComponent(url.searchParams.get('state')!)}`;

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
  leaving = vi.fn();
  network = vi.fn(async () => {
    throw new Error('Unexpected network request in the authorization fixture');
  });
  const location = Object.assign(new URL(options.appOrigin), {assign: leaving}),
    document = {cookie: ''},
    sessionStorage = storage();
  vi.stubGlobal('window', {
    crypto: webcrypto,
    btoa,
    atob,
    location,
    document,
    sessionStorage,
    localStorage: storage(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    open: vi.fn(),
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('location', location);
  vi.stubGlobal('sessionStorage', sessionStorage);
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('real Auth0 same-tab transport for delegate authorization', () => {
  it('sends byte payload, audience and PKCE through the actual authorize URL in this tab', async () => {
    const {url, saved} = await leaveFor([110, 1, 0, 64, 255]);
    expect(window.open).not.toHaveBeenCalled();
    expect(leaving).toHaveBeenCalledOnce();
    expect(url.origin).toBe('https://provider.example');
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.getAll('delegateAction')).toEqual(['110,1,0,64,255']);
    expect(url.searchParams.has('nep413')).toBe(false);
    expect(url.searchParams.has('transaction')).toBe(false);
    expect(url.searchParams.get('audience')).toBe(options.audience);
    expect(url.searchParams.get('client_id')).toBe(options.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(options.appOrigin);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('scope')?.split(' ')).toContain('transaction:sign');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved).toHaveBeenCalledExactlyOnceWith(url.searchParams.get('state'));
    expect(network).not.toHaveBeenCalled();
  });

  it('saves the return state before the tab leaves', async () => {
    const order: string[] = [];
    leaving.mockImplementation(() => void order.push('left'));
    await new NearAuthProvider(options).beginApproval([1], () => void order.push('saved'));
    expect(order).toEqual(['saved', 'left']);
  });

  it('finishes on a fresh page load with its PKCE verifier', async () => {
    const {url} = await leaveFor([5, 6]);
    network.mockResolvedValueOnce(tokenResponse(url, [5, 6], 3600));
    const token = await new NearAuthProvider(options).finishApproval(success(url), [5, 6]);
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toEqual({
      sub: player,
      fatxn: [5, 6],
    });
    expect(network).toHaveBeenCalledTimes(1);
    const [endpoint, request] = network.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('https://provider.example/oauth/token');
    expect(request.method).toBe('POST');
    const body = new URLSearchParams(String(request.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('fixture-authorization-code');
    expect(body.get('client_id')).toBe(options.clientId);
    expect(body.get('redirect_uri')).toBe(options.appOrigin);
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
      url.searchParams.get('code_challenge'),
    );
  });

  it('accepts an approval token that expires within the minute', async () => {
    const {url} = await leaveFor([7]);
    network.mockResolvedValueOnce(tokenResponse(url, [7], 30));
    expect(await new NearAuthProvider(options).finishApproval(success(url), [7])).toContain('.');
  });

  it('never replays a returned code', async () => {
    const {url} = await leaveFor([7]);
    network.mockResolvedValueOnce(tokenResponse(url, [7]));
    const provider = new NearAuthProvider(options);
    await provider.finishApproval(success(url), [7]);
    await expect(provider.finishApproval(success(url), [7])).rejects.toThrow('Invalid state');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('creates fresh state, nonce and PKCE for each approval', async () => {
    const first = await leaveFor([1, 2]),
      second = await leaveFor([3, 4]);
    for (const field of ['state', 'nonce', 'code_challenge']) {
      expect(second.url.searchParams.get(field)).toBeTruthy();
      expect(second.url.searchParams.get(field)).not.toBe(first.url.searchParams.get(field));
    }
    expect(second.url.searchParams.get('delegateAction')).toBe('3,4');
  });

  it('never grants a token the provider refused', async () => {
    const {url} = await leaveFor([5, 6]);
    network.mockResolvedValueOnce(
      Response.json({error: 'invalid_grant', error_description: 'Fixture code was rejected'}, {status: 400}),
    );
    await expect(new NearAuthProvider(options).finishApproval(success(url), [5, 6])).rejects.toThrow(
      'Fixture code was rejected',
    );
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback with different state before any token exchange', async () => {
    await leaveFor([7]);
    await expect(
      new NearAuthProvider(options).finishApproval('?code=untrusted-code&state=different-attempt', [7]),
    ).rejects.toThrow('Invalid state');
    expect(network).not.toHaveBeenCalled();
  });

  it('reports a declined approval without any token exchange', async () => {
    const {url} = await leaveFor([8]);
    await expect(new NearAuthProvider(options).finishApproval(denial(url), [8])).rejects.toThrow(
      'Authorization cancelled.',
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('allows a fresh approval after a declined one', async () => {
    const declined = await leaveFor([9]);
    await new NearAuthProvider(options).finishApproval(denial(declined.url), [9]).catch(() => {});
    const {url} = await leaveFor([10]);
    network.mockResolvedValueOnce(tokenResponse(url, [10]));
    expect(await new NearAuthProvider(options).finishApproval(success(url), [10])).toContain('.');
  });
});
