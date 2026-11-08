import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const authorizationUrl = 'https://provider.example/authorize?scope=openid';
let network: ReturnType<typeof vi.fn>, storage: Map<string, string>, leaving: ReturnType<typeof vi.fn>;
let login: typeof import('../src/lib/near-login');
beforeEach(async () => {
  // Every page load starts these modules fresh, so each test does too.
  vi.resetModules();
  login = await import('../src/lib/near-login');
  vi.useFakeTimers();
  storage = new Map();
  leaving = vi.fn();
  vi.stubGlobal('window', {location: {assign: leaving}, open: vi.fn()});
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  network = vi.fn(async (path: string) => {
    if (path.endsWith('/login/start'))
      return Response.json({authorizationUrl, attemptId: 'attempt-1', expiresAt: Date.now() + 300000});
    throw new Error(`Unexpected fixture route: ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const routes = () => network.mock.calls.map(([path]) => path as string);

describe('same-tab social sign-in without a transaction request', () => {
  it('sends this tab to the server URL and never opens a window', async () => {
    void login.signInWithNear().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(leaving).toHaveBeenCalledExactlyOnceWith(authorizationUrl);
    expect(window.open).not.toHaveBeenCalled();
    expect(routes()).toEqual(['/api/near/login/start']);
    expect(JSON.parse(network.mock.calls[0][1].body)).toEqual({});
  });
  it('keeps the page busy while the browser leaves, then reports a navigation that never happened', async () => {
    let settled = false;
    const result = login.signInWithNear().finally(() => {
        settled = true;
      }),
      check = expect(result).rejects.toThrow('The sign-in connection was interrupted');
    await vi.advanceTimersByTimeAsync(29000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await check;
  });
  it('refuses a sign-in address that is not secure', async () => {
    network.mockResolvedValueOnce(
      Response.json({authorizationUrl: 'http://provider.example/authorize', attemptId: 'a', expiresAt: 1}),
    );
    await expect(login.signInWithNear()).rejects.toThrow('Invalid sign-in response.');
    expect(leaving).not.toHaveBeenCalled();
  });
  it('shows a server refusal and stays on the page', async () => {
    network.mockResolvedValueOnce(Response.json({error: 'Try signing in again shortly.'}, {status: 429}));
    await expect(login.signInWithNear()).rejects.toThrow('Try signing in again shortly.');
    expect(leaving).not.toHaveBeenCalled();
  });
  it('turns a lost connection into a retry message and allows another try', async () => {
    network.mockRejectedValueOnce(new TypeError('connection lost'));
    await expect(login.signInWithNear()).rejects.toThrow('The sign-in connection was interrupted');
    void login.signInWithNear().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(leaving).toHaveBeenCalledOnce();
  });
  it('stops when the player cancels while the page is leaving', async () => {
    const controller = new AbortController(),
      check = expect(login.signInWithNear(controller.signal)).rejects.toThrow('Sign-in cancelled. Please try again.');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await check;
  });
  it('refuses a second sign-in while the first is leaving', async () => {
    void login.signInWithNear().catch(() => {});
    await expect(login.signInWithNear()).rejects.toThrow('current authorization');
    await vi.advanceTimersByTimeAsync(31000);
  });
  it('does not begin sign-in after its owner already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(login.signInWithNear(controller.signal)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});

describe('carrying on after the page comes back', () => {
  const approval = {
    kind: 'grant' as const,
    state: 'saved-state',
    id: 'prepared',
    payload: [1, 2],
    accountId: 'player',
  };
  it('resumes once after sign-in and never on a plain page load', () => {
    expect(login.takeEntryResume()).toBe(false);
    login.markEntryResume();
    expect(login.takeEntryResume()).toBe(true);
    expect(login.takeEntryResume()).toBe(false);
  });
  it('recognises the approval it left for and treats any other callback as sign-in', () => {
    login.saveApproval(approval);
    expect(login.holdApprovalReturn('?code=fixture&state=another-state')).toBe(false);
    expect(login.takeApprovalReturn('grant')).toBeUndefined();
    expect(login.holdApprovalReturn('?code=fixture&state=saved-state')).toBe(true);
    expect(storage.size).toBe(0);
    expect(login.takeEntryResume()).toBe(true);
    expect(login.takeApprovalReturn('revoke')).toBeUndefined();
    expect(login.takeApprovalReturn('grant')).toEqual({...approval, search: '?code=fixture&state=saved-state'});
    expect(login.takeApprovalReturn('grant')).toBeUndefined();
    expect(login.takeEntryResume()).toBe(false);
  });
  it('treats unreadable saved data as an ordinary sign-in', () => {
    storage.set('worldo.approval.pending', 'not json');
    expect(login.holdApprovalReturn('?code=fixture&state=saved-state')).toBe(false);
  });
  it('keeps working when storage is disabled', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('disabled');
      },
      setItem: () => {
        throw new Error('disabled');
      },
      removeItem: () => {
        throw new Error('disabled');
      },
    });
    expect(() => login.markEntryResume()).not.toThrow();
    expect(login.takeEntryResume()).toBe(false);
    expect(login.holdApprovalReturn('?code=fixture&state=saved-state')).toBe(false);
  });
});

describe('origin callback handoff', () => {
  it('detects only OAuth callback parameters, not an ordinary game URL', () => {
    expect(login.isNearLoginCallback('?ff=1')).toBe(false);
    expect(login.isNearLoginCallback('?code=unbound')).toBe(false);
    expect(login.isNearLoginCallback('?code=fixture&state=bound')).toBe(true);
    expect(login.isNearLoginCallback('?error=access_denied&state=bound')).toBe(true);
  });
  it('posts code and state once to the same-origin server, with no client token or account', async () => {
    network.mockResolvedValueOnce(Response.json({ok: true}));
    await login.completeNearLogin('?state=bound&code=fixture');
    expect(network).toHaveBeenCalledTimes(1);
    const [path, init] = network.mock.calls[0];
    expect(path).toBe('/api/near/login/complete');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({state: 'bound', code: 'fixture'});
  });
  it('passes only the provider error code, never untrusted descriptions', async () => {
    network.mockResolvedValueOnce(Response.json({error: 'Sign-in was cancelled.'}, {status: 401}));
    await expect(
      login.completeNearLogin('?state=bound&error=access_denied&error_description=%3Cscript%3E'),
    ).rejects.toThrow('Sign-in was cancelled.');
    expect(JSON.parse(network.mock.calls[0][1].body)).toEqual({state: 'bound', error: 'access_denied'});
    await expect(login.completeNearLogin('?code=fixture')).rejects.toThrow('Invalid sign-in response.');
    expect(network).toHaveBeenCalledTimes(1);
  });
});
