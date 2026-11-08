import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const approval = vi.hoisted(() => ({begin: vi.fn(), finish: vi.fn()}));
vi.mock('../src/lib/near-provider', () => ({
  NearAuthProvider: class {
    beginApproval = approval.begin;
    finishApproval = approval.finish;
  },
}));
type Client = typeof import('../src/lib/near-auth');
type Login = typeof import('../src/lib/near-login');
let client: Client, login: Login, network: ReturnType<typeof vi.fn>, relayed: boolean;
let identity: import('../src/lib/near-auth').NearIdentity, grant: import('../src/lib/near-auth').GameplaySession;
let storage: Map<string, string>;
const config = {
  authConfigured: true,
  clientId: 'app',
  authDomain: 'provider.example',
  authAudience: 'signing-api',
  authGuardId: 'jwt#https://provider.example/',
  appOrigin: 'https://worldo.example',
  network: 'testnet',
  contractId: 'worldo.testnet',
};
const returned = '?code=fixture&state=returned-state';
const paths = () => network.mock.calls.map(([path]) => path as string);
const original = () => network.getMockImplementation() as (path: string, init?: RequestInit) => Promise<Response>;
/** The page leaves for NEAR Auth, so the first call never ends. The return is a fresh
 * page load: modules start again and the saved approval is the only thing that survives. */
async function loadPage() {
  vi.resetModules();
  login = await import('../src/lib/near-login');
  client = await import('../src/lib/near-auth');
}
async function approveAndReturn(search = returned) {
  const begun = approval.begin.mock.calls.length;
  void client.authorizeGameplaySession().catch(() => {});
  await vi.waitFor(() => expect(approval.begin).toHaveBeenCalledTimes(begun + 1));
  await loadPage();
  return login.holdApprovalReturn(search);
}
beforeEach(async () => {
  vi.resetModules();
  approval.begin.mockReset();
  approval.finish.mockReset();
  relayed = false;
  storage = new Map();
  identity = {
    accountId: 'player-account',
    publicKey: 'ed25519:fixture',
    expiresAt: Date.now() + 3600000,
    network: 'testnet',
  };
  grant = {
    accountId: identity.accountId,
    publicKey: identity.publicKey,
    contractId: config.contractId,
    network: config.network,
    expiresAt: Date.now() + 3600000,
    spendLimit: 100000,
    spent: 0,
    authorizedAt: 100,
    createdAt: 90,
    state: 'active',
  };
  vi.stubGlobal('window', {open: vi.fn()});
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  approval.begin.mockImplementation(async (_payload, beforeLeaving) => beforeLeaving('returned-state'));
  approval.finish.mockResolvedValue('fixture-token');
  network = vi.fn(async (path: string) => {
    if (path.endsWith('/identity')) return Response.json({identity});
    if (path === '/api/near/status') return Response.json(config);
    if (path.endsWith('/gameplay-session/status')) return Response.json({session: null});
    if (path.endsWith('/gameplay-session/confirm'))
      return relayed
        ? Response.json({session: grant, finalizedBlockHeight: '101'})
        : Response.json(
            {error: 'Authorize Worldo game-token settlement first.', finalizedBlockHeight: '100'},
            {status: 422},
          );
    if (path.endsWith('/prepare-wallet')) return Response.json({ok: true});
    if (path.endsWith('/gameplay-session/prepare'))
      return Response.json({
        id: 'prepared-id',
        payload: [1, 2, 3],
        kind: 'delegateAction',
        network: config.network,
        publicKey: identity.publicKey,
        session: {...grant, state: 'pending'},
        maxBlockHeight: '500',
      });
    if (path.endsWith('/relay')) {
      relayed = true;
      return Response.json({hash: 'fixture-hash'});
    }
    if (path.endsWith('/gameplay-session/revoke-prepare')) return Response.json({id: 'revoke-id', payload: [9]});
    throw new Error(`Unexpected fixture route: ${path}`);
  });
  vi.stubGlobal('fetch', network);
  await loadPage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('one-click social onboarding and bounded gameplay approval', () => {
  it('leaves for approval, comes back, and enters only after a valid grant confirmation', async () => {
    expect(await approveAndReturn()).toBe(true);
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(0);
    expect(await client.authorizeGameplaySession({expectedAccountId: identity.accountId})).toEqual(grant);
    expect(window.open).not.toHaveBeenCalled();
    expect(approval.begin).toHaveBeenCalledTimes(1);
    expect(approval.finish).toHaveBeenCalledExactlyOnceWith(returned, [1, 2, 3]);
    const relay = network.mock.calls.find(([path]) => (path as string).endsWith('/relay'))!;
    expect(JSON.parse(relay[1].body)).toEqual({id: 'prepared-id', token: 'fixture-token'});
    expect(storage.size).toBe(0);
  });
  it('saves everything the return needs before it leaves the page', async () => {
    void client.authorizeGameplaySession().catch(() => {});
    await vi.waitFor(() => expect(approval.begin).toHaveBeenCalled());
    expect(JSON.parse(storage.get('worldo.approval.pending')!)).toEqual({
      kind: 'grant',
      state: 'returned-state',
      id: 'prepared-id',
      payload: [1, 2, 3],
      accountId: identity.accountId,
      maxBlockHeight: '500',
      previousAuthorizedAt: null,
    });
    expect(paths()).not.toContain('/api/near/relay');
  });
  it('prepares a fresh approval when the player came back without finishing the last one', async () => {
    await approveAndReturn('?ff=1');
    expect(await approveAndReturn()).toBe(true);
    expect(approval.begin).toHaveBeenCalledTimes(2);
    expect(await client.authorizeGameplaySession()).toEqual(grant);
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(1);
  });
  it('does not finish an approval for another signed-in account', async () => {
    await approveAndReturn();
    identity = {...identity, accountId: 'different-account'};
    await expect(client.authorizeGameplaySession()).rejects.toThrow('account changed');
    expect(approval.finish).not.toHaveBeenCalled();
    expect(paths()).not.toContain('/api/near/relay');
  });
  it('revokes through the same round trip, without entering the game', async () => {
    void client.revokeGameplaySession().catch(() => {});
    await vi.waitFor(() => expect(approval.begin).toHaveBeenCalled());
    await loadPage();
    expect(await client.finishGameplayRevocation()).toBe(false);
    expect(login.holdApprovalReturn(returned)).toBe(true);
    expect(login.takeEntryResume()).toBe(false);
    expect(await client.finishGameplayRevocation()).toBe(true);
    expect(approval.finish).toHaveBeenCalledExactlyOnceWith(returned, [9]);
    const relay = network.mock.calls.find(([path]) => (path as string).endsWith('/relay'))!;
    expect(JSON.parse(relay[1].body)).toEqual({id: 'revoke-id', token: 'fixture-token'});
    expect(await client.finishGameplayRevocation()).toBe(false);
  });
  it('reuses an existing active grant without resetting its spending or requesting approval', async () => {
    grant.spent = 73;
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/gameplay-session/status') ? Promise.resolve(Response.json({session: grant})) : base(path, init),
    );
    expect(await client.authorizeGameplaySession({expectedAccountId: identity.accountId})).toEqual(grant);
    expect(approval.begin).not.toHaveBeenCalled();
    expect(paths()).not.toContain('/api/near/prepare-wallet');
    expect(paths()).not.toContain('/api/near/gameplay-session/prepare');
    expect(paths()).not.toContain('/api/near/relay');
    expect(grant.spent).toBe(73);
  });
  it('recovers an on-chain grant missing from the local cache before preparing anything', async () => {
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/gameplay-session/confirm') ? Promise.resolve(Response.json({session: grant})) : base(path, init),
    );
    expect(await client.authorizeGameplaySession()).toEqual(grant);
    expect(approval.begin).not.toHaveBeenCalled();
    expect(paths()).not.toContain('/api/near/prepare-wallet');
  });
  it('does not relay after the player denies approval', async () => {
    approval.finish.mockRejectedValue(new Error('Authorization cancelled.'));
    await approveAndReturn();
    await expect(client.authorizeGameplaySession()).rejects.toThrow('Authorization cancelled.');
    expect(paths()).not.toContain('/api/near/relay');
    expect(storage.size).toBe(0);
  });
  it('stops an aborted preflight before preparing or signing a grant', async () => {
    const controller = new AbortController(),
      base = original();
    network.mockImplementation(async (path: string, init?: RequestInit) => {
      const response = await base(path, init);
      if (path.endsWith('/prepare-wallet')) controller.abort();
      return response;
    });
    await expect(client.authorizeGameplaySession({signal: controller.signal})).rejects.toThrow(
      'Authorization cancelled.',
    );
    expect(approval.begin).not.toHaveBeenCalled();
    expect(paths()).not.toContain('/api/near/gameplay-session/prepare');
    expect(paths()).not.toContain('/api/near/relay');
  });
  it('does not relay a late successful approval after cancellation', async () => {
    const controller = new AbortController();
    approval.finish.mockImplementation(async () => {
      controller.abort();
      return 'fixture-token';
    });
    await approveAndReturn();
    await expect(client.authorizeGameplaySession({signal: controller.signal})).rejects.toThrow(
      'Authorization cancelled.',
    );
    expect(paths()).not.toContain('/api/near/relay');
    expect(storage.size).toBe(0);
  });
  it('rejects an account switch before preparing the wallet', async () => {
    await expect(client.authorizeGameplaySession({expectedAccountId: 'different-account'})).rejects.toThrow(
      'account changed',
    );
    expect(paths()).not.toContain('/api/near/prepare-wallet');
    expect(approval.begin).not.toHaveBeenCalled();
  });
  it.each([{accountId: 'different-owner'}, {network: 'mainnet'}, {contractId: 'different-contract'}])(
    'rejects a prepared grant outside the expected owner and scope: %j',
    async change => {
      const base = original();
      network.mockImplementation((path: string, init?: RequestInit) =>
        path.endsWith('/gameplay-session/prepare')
          ? Promise.resolve(
              Response.json({
                id: 'prepared-id',
                payload: [1],
                kind: 'delegateAction',
                network: config.network,
                publicKey: identity.publicKey,
                session: {...grant, ...change, state: 'pending'},
              }),
            )
          : base(path, init),
      );
      await expect(client.authorizeGameplaySession()).rejects.toThrow('account changed');
      expect(approval.begin).not.toHaveBeenCalled();
      expect(paths()).not.toContain('/api/near/relay');
    },
  );
  it.each([
    {state: 'pending'},
    {state: 'revoked'},
    {expiresAt: 1},
    {spent: 100000},
    {accountId: 'other-owner'},
    {network: 'mainnet'},
    {contractId: 'other-contract'},
  ])('does not report success for invalid final confirmation: %j', async change => {
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/gameplay-session/confirm') && relayed
        ? Promise.resolve(Response.json({session: {...grant, ...change}}))
        : base(path, init),
    );
    await approveAndReturn();
    await expect(client.authorizeGameplaySession()).rejects.toThrow('still being confirmed');
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(1);
    expect(storage.size).toBe(1);
  });
  it('recovers a lost relay response through confirmation without sending again', async () => {
    const base = original();
    network.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/relay')) {
        relayed = true;
        throw new TypeError('response lost');
      }
      return base(path, init);
    });
    await approveAndReturn();
    expect(await client.authorizeGameplaySession()).toEqual(grant);
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(1);
    expect(approval.begin).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(0);
  });
  it('keeps uncertainty through reload and only checks confirmation on the next click', async () => {
    const base = original();
    network.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/relay')) throw new TypeError('response lost');
      return base(path, init);
    });
    await approveAndReturn();
    await expect(client.authorizeGameplaySession()).rejects.toThrow('still being confirmed');
    expect(storage.size).toBe(1);
    await loadPage();
    await expect(client.authorizeGameplaySession()).rejects.toThrow('still being confirmed');
    expect(approval.begin).toHaveBeenCalledTimes(1);
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(1);
  });
  it('permits a new explicit attempt when the server proves that nothing was submitted', async () => {
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/relay')
        ? Promise.resolve(
            Response.json({error: 'Authorization expired. Please approve it again.', submitted: false}, {status: 422}),
          )
        : base(path, init),
    );
    await approveAndReturn();
    await expect(client.authorizeGameplaySession()).rejects.toThrow('Authorization expired');
    expect(storage.size).toBe(0);
    network.mockImplementation(base);
    await approveAndReturn();
    expect(await client.authorizeGameplaySession()).toEqual(grant);
    expect(approval.begin).toHaveBeenCalledTimes(2);
  });
  it('does not mistake an older active grant for the uncertain new authorization', async () => {
    const key = `worldo.pendingGameplay.testnet.worldo.testnet.${identity.accountId}`;
    storage.set(key, JSON.stringify({previousAuthorizedAt: 100}));
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/gameplay-session/confirm') ? Promise.resolve(Response.json({session: grant})) : base(path, init),
    );
    await expect(client.authorizeGameplaySession()).rejects.toThrow('still being confirmed');
    expect(storage.has(key)).toBe(true);
    expect(approval.begin).not.toHaveBeenCalled();
    grant.authorizedAt = 200;
    expect(await client.authorizeGameplaySession()).toEqual(grant);
    expect(storage.has(key)).toBe(false);
    expect(approval.begin).not.toHaveBeenCalled();
  });
  it('allows a fresh explicit approval only after the same FINAL read proves the old delegate expired', async () => {
    const key = `worldo.pendingGameplay.testnet.worldo.testnet.${identity.accountId}`;
    storage.set(key, JSON.stringify({previousAuthorizedAt: null, maxBlockHeight: '99'}));
    await approveAndReturn();
    expect(await client.authorizeGameplaySession()).toEqual(grant);
    expect(approval.begin).toHaveBeenCalledTimes(1);
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(1);
    expect(storage.size).toBe(0);
  });
  it.each(['100', '101', undefined, 'not-a-height'])(
    'retains pending authorization without a strictly later verified FINAL height: %s',
    async maxBlockHeight => {
      const key = `worldo.pendingGameplay.testnet.worldo.testnet.${identity.accountId}`;
      storage.set(key, JSON.stringify({previousAuthorizedAt: null, maxBlockHeight}));
      await expect(client.authorizeGameplaySession()).rejects.toThrow('still being confirmed');
      expect(approval.begin).not.toHaveBeenCalled();
      expect(storage.has(key)).toBe(true);
    },
  );
  it('does not substitute elapsed wall-clock time for chain expiry evidence', async () => {
    const key = `worldo.pendingGameplay.testnet.worldo.testnet.${identity.accountId}`;
    storage.set(key, JSON.stringify({previousAuthorizedAt: null, maxBlockHeight: '99', createdAt: 1}));
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/gameplay-session/confirm')
        ? Promise.resolve(Response.json({error: 'Authorize Worldo game-token settlement first.'}, {status: 422}))
        : base(path, init),
    );
    await expect(client.authorizeGameplaySession()).rejects.toThrow('still being confirmed');
    expect(approval.begin).not.toHaveBeenCalled();
    expect(storage.has(key)).toBe(true);
  });
  it('does not treat a failed confirmation read as proof that no grant exists', async () => {
    const base = original();
    network.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/gameplay-session/confirm')
        ? Promise.resolve(Response.json({error: 'NEAR is temporarily unavailable.'}, {status: 422}))
        : base(path, init),
    );
    await expect(client.authorizeGameplaySession()).rejects.toThrow('temporarily unavailable');
    expect(paths()).not.toContain('/api/near/prepare-wallet');
    expect(approval.begin).not.toHaveBeenCalled();
  });
  it('prevents overlapping approval attempts while the page is leaving', async () => {
    const controller = new AbortController(),
      first = expect(client.authorizeGameplaySession({signal: controller.signal})).rejects.toThrow(
        'Authorization cancelled.',
      );
    await vi.waitFor(() => expect(approval.begin).toHaveBeenCalledTimes(1));
    await expect(client.authorizeGameplaySession()).rejects.toThrow('current authorization');
    controller.abort();
    await first;
  });
  it('keeps confirming an already dispatched relay after cancellation', async () => {
    const controller = new AbortController(),
      base = original();
    network.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/relay')) controller.abort();
      return base(path, init);
    });
    await approveAndReturn();
    expect(await client.authorizeGameplaySession({signal: controller.signal})).toEqual(grant);
    expect(paths().filter(path => path.endsWith('/relay'))).toHaveLength(1);
    expect(storage.size).toBe(0);
  });
  it('does not leave the page for an already-aborted call', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client.authorizeGameplaySession({signal: controller.signal})).rejects.toThrow();
    expect(approval.begin).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
