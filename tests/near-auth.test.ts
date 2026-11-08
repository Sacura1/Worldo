import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {canonicalAppOrigin, nearAuthConfiguration, nearAuthDerivationPath} from '../server/near-config';

const auth = vi.hoisted(() => ({
  redirect: vi.fn(),
  callback: vi.fn(),
  claims: vi.fn(),
  logout: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock('@auth0/auth0-spa-js', () => ({
  Auth0Client: class {
    private cache: unknown;
    constructor(options: {cache: unknown}) {
      auth.constructor(options);
      this.cache = options.cache;
    }
    loginWithRedirect = auth.redirect;
    handleRedirectCallback = (url: string) => auth.callback(url, this.cache);
    getIdTokenClaims = auth.claims;
    logout = auth.logout;
  },
}));
import {NearAuthProvider, type NearAuthOptions} from '../src/lib/near-provider';
const options: NearAuthOptions = {
  clientId: 'approved-app',
  domain: 'approved.auth0.com',
  audience: 'approved-signing-api',
  guardId: 'jwt#https://approved.auth0.com/',
  appOrigin: 'https://worldo.example',
};
const token = (fatxn: unknown, sub = 'google-oauth2|player') =>
  `header.${Buffer.from(JSON.stringify({sub, fatxn})).toString('base64url')}.signature`;
const approvalKey = '@@auth0spajs@@::approved-app::approved-signing-api::openid profile email transaction:sign';
type TestCache = {set: (key: string, entry: unknown) => void};
const returnsToken = (value: string) => (_url: string, cache: TestCache) =>
  cache.set(approvalKey, {body: {access_token: value}, expiresAt: 1});
beforeEach(() => {
  vi.clearAllMocks();
  auth.claims.mockResolvedValue({sub: 'google-oauth2|player'});
  auth.redirect.mockImplementation(async ({openUrl}) =>
    openUrl('https://approved.auth0.com/authorize?state=returned-state&delegateAction=1'),
  );
  auth.callback.mockImplementation(returnsToken(token([1, 2, 255])));
  vi.stubGlobal('window', {location: {assign: vi.fn()}});
});
afterEach(() => vi.unstubAllGlobals());

describe('trusted production auth configuration', () => {
  it('uses official mainnet defaults without making sign-in configured', () => {
    const c = nearAuthConfiguration({NEAR_NETWORK: 'mainnet'});
    expect(c.clientId).toBeNull();
    expect(c.issuer).toBe('https://login.auth.near.org/');
    expect(c.audience).toBe('auth0.jwt.fast-auth.near');
  });
  it.each(['mainnet', 'testnet'])('derives the %s profile when optional auth values are blank', network => {
    const c = nearAuthConfiguration({
      NEAR_NETWORK: network,
      NEAR_AUTH_CLIENT_ID: ' ',
      NEAR_AUTH_DOMAIN: '',
      NEAR_AUTH_AUDIENCE: '  ',
      NEAR_AUTH_GUARD_ID: '',
    });
    const domain = network === 'testnet' ? 'login.testnet.fast-auth.com' : 'login.auth.near.org';
    expect(c).toMatchObject({
      domain,
      issuer: `https://${domain}/`,
      guardId: `jwt#https://${domain}/`,
      audience: network === 'testnet' ? 'auth0.jwt.fast-auth.testnet' : 'auth0.jwt.fast-auth.near',
      clientId: network === 'testnet' ? 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl' : null,
    });
  });
  it.each(['mainnet', 'testnet'])('rejects each opposite-network official auth value on %s', network => {
    const oppositeDomain = network === 'mainnet' ? 'login.testnet.fast-auth.com' : 'login.auth.near.org';
    const oppositeAudience = network === 'mainnet' ? 'auth0.jwt.fast-auth.testnet' : 'auth0.jwt.fast-auth.near';
    const changes = [
      {NEAR_AUTH_DOMAIN: `https://${oppositeDomain.toUpperCase()}/`},
      {NEAR_AUTH_AUDIENCE: oppositeAudience},
      {NEAR_AUTH_GUARD_ID: `jwt#https://${oppositeDomain.toUpperCase()}/`},
    ];
    for (const change of changes)
      expect(() =>
        nearAuthConfiguration({NEAR_NETWORK: network, NEAR_AUTH_CLIENT_ID: 'approved-app', ...change}),
      ).toThrow('does not match the selected network');
  });
  it.each(['np8paqIpMWmNbzT4xAvOOapZBjsOpptl', 'dsurLc47fOcWme5PkYeClBvuW0tYrmgW'])(
    'rejects shared or example client %s on mainnet',
    clientId => {
      expect(() => nearAuthConfiguration({NEAR_NETWORK: 'mainnet', NEAR_AUTH_CLIENT_ID: ` ${clientId} `})).toThrow(
        'approved mainnet application',
      );
    },
  );
  it.each(['mainnet', 'testnet'])('preserves custom approved auth configuration on %s', network => {
    const c = nearAuthConfiguration({
      NEAR_NETWORK: network,
      NEAR_AUTH_CLIENT_ID: 'approved-app',
      NEAR_AUTH_DOMAIN: 'custom.auth0.com',
      NEAR_AUTH_AUDIENCE: 'custom-signing-api',
      NEAR_AUTH_GUARD_ID: 'jwt#custom-registered-guard',
    });
    expect(c).toMatchObject({
      clientId: 'approved-app',
      domain: 'custom.auth0.com',
      audience: 'custom-signing-api',
      guardId: 'jwt#custom-registered-guard',
    });
  });
  it('derives the account through the same approved guard used for signing', () => {
    const c = nearAuthConfiguration({
      NEAR_AUTH_CLIENT_ID: 'app',
      NEAR_AUTH_DOMAIN: 'https://approved.auth0.com/',
      NEAR_AUTH_AUDIENCE: 'approved-api',
      NEAR_AUTH_GUARD_ID: 'jwt#approved-registered-guard',
      PUBLIC_URL: 'https://worldo.example',
      NODE_ENV: 'production',
    });
    expect(c.domain).toBe('approved.auth0.com');
    expect(c.audience).toBe('approved-api');
    expect(nearAuthDerivationPath('subject', c)).toBe('jwt#approved-registered-guard#subject');
  });
  it('rejects ambiguous callback origins and insecure production origins', () => {
    expect(() => canonicalAppOrigin({PUBLIC_URL: 'https://one.example', APP_ORIGIN: 'https://two.example'})).toThrow(
      'same origin',
    );
    expect(() => canonicalAppOrigin({PUBLIC_URL: 'http://worldo.example', NODE_ENV: 'production'})).toThrow('HTTPS');
    expect(() => canonicalAppOrigin({NODE_ENV: 'production'})).toThrow('PUBLIC_URL');
    expect(canonicalAppOrigin({PUBLIC_URL: 'https://worldo.example/', APP_ORIGIN: 'https://worldo.example'})).toBe(
      'https://worldo.example',
    );
  });
  it('rejects an issuer URL with credentials, a path, or insecure protocol', () => {
    for (const domain of [
      'https://person:secret@approved.auth0.com',
      'https://approved.auth0.com/path',
      'http://approved.auth0.com',
    ])
      expect(() => nearAuthConfiguration({NEAR_AUTH_DOMAIN: domain})).toThrow();
  });
});

describe('fresh payload-bound browser authorization', () => {
  it('leaves this tab for the exact scope after saving the state to expect back', async () => {
    const p = new NearAuthProvider(options),
      order: string[] = [],
      save = vi.fn((state: string) => void order.push(`saved ${state}`));
    vi.mocked(window.location.assign).mockImplementation(() => void order.push('left'));
    await p.beginApproval([1, 2, 255], save);
    expect(auth.redirect.mock.calls[0][0].authorizationParams).toEqual({
      audience: options.audience,
      scope: 'transaction:sign',
      redirect_uri: options.appOrigin,
      delegateAction: [1, 2, 255],
    });
    expect(order).toEqual(['saved returned-state', 'left']);
  });
  it.each([[[]], [[256]], [[1.5]], [[-1]]])('refuses to leave with a malformed payload: %j', async payload => {
    await expect(new NearAuthProvider(options).beginApproval(payload, vi.fn())).rejects.toThrow('Invalid');
    expect(auth.redirect).not.toHaveBeenCalled();
  });
  it('exchanges the returned code and reads a token however short its life', async () => {
    const p = new NearAuthProvider(options);
    expect(await p.finishApproval('?code=fixture&state=returned-state', [1, 2, 255])).toBe(token([1, 2, 255]));
    expect(auth.callback.mock.calls[0][0]).toBe('https://worldo.example/?code=fixture&state=returned-state');
  });
  it('uses an approval token only once', async () => {
    const p = new NearAuthProvider(options);
    await p.finishApproval('?code=fixture&state=returned-state', [1, 2, 255]);
    auth.callback.mockImplementation(async () => {});
    await expect(p.finishApproval('?code=again&state=returned-state', [1, 2, 255])).rejects.toThrow('No authorization');
  });
  it('rejects a token that approves a different action', async () => {
    const p = new NearAuthProvider(options);
    await expect(p.finishApproval('?code=fixture&state=s', [2])).rejects.toThrow('does not match');
  });
  it('rejects a token for a different authenticated subject', async () => {
    auth.callback.mockImplementation(returnsToken(token([1], 'another-player')));
    const p = new NearAuthProvider(options);
    await expect(p.finishApproval('?code=fixture&state=s', [1])).rejects.toThrow('different sign-in');
  });
  it('reports a declined approval in plain words', async () => {
    auth.callback.mockRejectedValue({error: 'access_denied'});
    const p = new NearAuthProvider(options);
    await expect(p.finishApproval('?error=access_denied&state=s', [1])).rejects.toThrow('Authorization cancelled.');
  });
  it('passes through any other provider failure', async () => {
    auth.callback.mockRejectedValue(new Error('Invalid state'));
    const p = new NearAuthProvider(options);
    await expect(p.finishApproval('?code=fixture&state=s', [1])).rejects.toThrow('Invalid state');
  });
  it('uses the configured logout origin and rejects sign-in on another host', async () => {
    const p = new NearAuthProvider(options);
    await p.logout();
    expect(auth.logout).toHaveBeenCalledWith({logoutParams: {returnTo: options.appOrigin}});
    vi.stubGlobal('location', {origin: 'https://other.example'});
    expect(() => new NearAuthProvider(options)).toThrow('Open https://worldo.example');
  });
});
